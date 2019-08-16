/**
* CrossAccountStackExport: A Lambda function that returns information about a single Stack Export which may be in another Account and/or Region.
**/

let responseData;
let params = {};

exports.handler = function(event, context) {
  console.info('Request body:\n' + JSON.stringify(event));

  responseData = {};

  let region = (event.ResourceProperties.Region) ? event.ResourceProperties.Region : process.env.AWS_REGION;

  let accountId = (event.ResourceProperties.AccountId) ? event.ResourceProperties.AccountId : context.invokedFunctionArn.split(':')[4];

  let exportName = event.ResourceProperties.ExportName;
  if (! exportName) {
    responseData = {Error: 'ExportName missing'};
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

          getExport(event, context, cloudformation, exportName, {});
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

function getExport(event, context, cloudformation, exportName, params) {
  console.info('Calling: ListExports...');
  cloudformation.listExports(params, function(err, data) {
    if (err) {
      responseData = {Error: 'ListExports call failed'};
      console.error('Error: ' + responseData.Error + ':\n', err);
      sendResponse(event, context, 'FAILED', responseData);
    }
    else {
      console.info('Finding: Export...');
      let e = data.Exports.find(e => e.Name === exportName)
      if (e) {
        responseData.Name = e.Name;
        console.info('Export: ' + e.Name + ' = ' + e.Value);
        sendResponse(event, context, 'SUCCESS', responseData, e.Value);
      }
      else {
        if (data.NextToken) {
          params.NextToken = data.NextToken;
          getExport(event, context, cloudformation, exportName, params);
        }
        else {
          responseData = {Error: 'Could not find ' + exportName + ' Export'};
          console.error('Error: ' + responseData.Error);
          sendResponse(event, context, 'FAILED', responseData);
        }
      }
    }
  });
}

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
