/**
* CrossAccountVpc: A Lambda function that returns information about a single VPC which may be in another Account and/or Region.
**/

exports.handler = function(event, context) {
  console.info('Request body:\n' + JSON.stringify(event));

  let responseData = {};
  let params = {};

  let region = (event.ResourceProperties.Region) ? event.ResourceProperties.Region : process.env.AWS_REGION;

  let accountId = (event.ResourceProperties.AccountId) ? event.ResourceProperties.AccountId : context.invokedFunctionArn.split(':')[4];

  let vpcName = event.ResourceProperties.VpcName;
  if (! vpcName) {
    responseData = {Error: 'VpcName missing'};
    console.error('Error: ' + responseData.Error);
    sendResponse(event, context, 'FAILED', responseData);
    return;
  }

  let roleArn = 'arn:aws:iam::' + accountId + ':role/CrossAccountReadOnlyRole';

  const AWS = require('aws-sdk');
  AWS.config.update({region: region});
  AWS.config.apiVersions = {
    sts: '2011-06-15',
    ec2: '2016-11-15'
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
          const ec2 = new AWS.EC2({accessKeyId: data.Credentials.AccessKeyId,
                                   secretAccessKey: data.Credentials.SecretAccessKey,
                                   sessionToken: data.Credentials.SessionToken});

          console.info('Calling: DescribeVpcs...');
          params = {
            Filters: [{Name: 'tag:Name', Values: [ vpcName ]}]
          };
          ec2.describeVpcs(params, function(err, data) {
            if (err) {
              responseData = {Error: 'DescribeVpcs call failed'};
              console.error('Error: ' + responseData.Error + ':\n', err);
              sendResponse(event, context, 'FAILED', responseData);
            }
            else {
              if (data.Vpcs.length == 1) {
                let vpc = data.Vpcs.map(v => ({VpcId: v.VpcId, CidrBlock: v.CidrBlock}))[0];
                responseData.CidrBlock = vpc.CidrBlock;
                console.info('VPC: ' + vpcName + ' (' + vpc.VpcId + ')');
                sendResponse(event, context, 'SUCCESS', responseData, vpc.VpcId);
              }
              else if (data.Vpcs.length > 1) {
                responseData = {Error: 'Found multiple ' + vpcName + ' VPCs!'};
                console.error('Error: ' + responseData.Error);
                sendResponse(event, context, 'FAILED', responseData);
              }
              else {
                responseData = {Error: 'Could not find ' + vpcName + ' VPC'};
                console.error('Error: ' + responseData.Error);
                sendResponse(event, context, 'FAILED', responseData);
              }
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
