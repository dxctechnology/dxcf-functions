/**
* CrossAccountStackExports: A Lambda function that returns information about all Exports created by a Stack which may be in another Account and/or Region.
**/

exports.handler = function(event, context) {
  console.info('Request body:\n' + JSON.stringify(event));

  let responseData = {};
  let params = {};

  let region = (event.ResourceProperties.Region) ? event.ResourceProperties.Region : process.env.AWS_REGION;

  let accountId = (event.ResourceProperties.AccountId) ? event.ResourceProperties.AccountId : context.invokedFunctionArn.split(':')[4];

  let stackName = event.ResourceProperties.StackName;
  if (! stackName) {
    responseData = {Error: 'StackName missing'};
    console.error('Error: ' + responseData.Error);
    sendResponse(event, context, 'FAILED', responseData);
    return;
  }

  let roleArn = 'arn:aws:iam::' + accountId + ':role/CrossAccountReadOnlyRole';

  const AWS = require('aws-sdk');
  AWS.config.update({region: region});
  AWS.config.apiVersions = {
    sts: '2011-06-15',
    cloudformation: '2010-05-15'
  };

  const sts = new AWS.STS();

  switch (event.RequestType) {
    case 'Create':
    case 'Update':
      console.info('Calling: AssumeRole...');
      params = {
        RoleArn: roleArn,
        RoleSessionName: 'AccountInformationSession'
      };
      sts.assumeRole(params, function(err, data) {
        if (err) {
          responseData = {Error: 'AssumeRole call failed'};
          console.error('Error: ' + responseData.Error + ':\n', err);
          sendResponse(event, context, 'FAILED', responseData);
        }
        else {
          console.info('Role: ' + roleArn + ' assumed');
          let cloudformation = new AWS.CloudFormation({accessKeyId: data.Credentials.AccessKeyId,
                                                       secretAccessKey: data.Credentials.SecretAccessKey,
                                                       sessionToken: data.Credentials.SessionToken});

          console.info('Calling: DescribeStacks...');
          params = {
            StackName: stackName
          };
          cloudformation.describeStacks(params, function(err, data) {
            if (err) {
              responseData = {Error: 'DescribeStacks call failed'};
              console.error('Error: ' + responseData.Error + ':\n', err);
              sendResponse(event, context, 'FAILED', responseData);
            }
            else {
              console.info('Exports for Stack: ' + stackName);
              data.Stacks[0].Outputs.filter(o => o.hasOwnProperty('ExportName'))
                                    .map(o => ({Name: o.ExportName, Value: o.OutputValue}))
                                    .sort((x, y) => x.Name.localeCompare(y.Name))
                                    .filter(e => {responseData[e.Name] = e.Value; return false;});
              sendResponse(event, context, 'SUCCESS', responseData);
            }
          });
        }
      });
      break;

    case 'Delete':
      sendResponse(event, context, 'SUCCESS');
      break;

    default:
      responseData = {Error: 'Unknown operation: ' + event.RequestType};
      console.error('Error: ' + responseData.Error);
      sendResponse(event, context, 'FAILED', responseData);
  }
};

function sendResponse(event, context, responseStatus, responseData, physicalResourceId, noEcho) {
  let responseBody = JSON.stringify({
    Status: responseStatus,
    Reason: 'See the details in CloudWatch Log Stream: ' + context.logStreamName,
    PhysicalResourceId: physicalResourceId || context.logStreamName,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    NoEcho: noEcho || false,
    Data: responseData
  });

  console.info('Response body:\n', responseBody);

  const https = require('https');
  const url = require('url');

  let parsedUrl = url.parse(event.ResponseURL);
  let options = {
    hostname: parsedUrl.hostname,
    port: 443,
    path: parsedUrl.path,
    method: 'PUT',
    headers: {
      'content-type': '',
      'content-length': responseBody.length
    }
  };

  let request = https.request(options, function(response) {
    console.info('Status code: ' + response.statusCode);
    console.info('Status message: ' + response.statusMessage);
    context.done();
  });

  request.on('error', function(error) {
    console.info('send(..) failed executing https.request(..): ' + error);
    context.done();
  });

  request.write(responseBody);
  request.end();
}
