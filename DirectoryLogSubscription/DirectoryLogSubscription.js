/**
* DirectoryLogSubscription: A Lambda function that manages a
* Log Subscription for a directory service.
**/

exports.handler = function(event, context) {
  console.log('Request body:\n' + JSON.stringify(event));

  let responseData = {};
  let params = {};

  let dId = event.ResourceProperties.DirectoryId;
  if (! /^d-[0-9a-f]{10}$/.test(dId)) {
    responseData = {Error: 'DirectoryId invalid: must be a valid Directory Id of the form d-9999999999, or "d-" followed by 10 hex digits'};
    console.error('Error: ' + responseData.Error);
    sendResponse(event, context, 'FAILED', responseData);
    return;
  }

  let lgName = event.ResourceProperties.LogGroup;
  if (! /^[-/0-9a-zA-Z]{5,64}$/.test(lgName) && event.RequestType != 'Delete') {
    responseData = {Error: 'LogGroup invalid: must be a valid LogGroup Name, consisting of aphanumeric characters, slashes and dashes'};
    console.error('Error: ' + responseData.Error);
    sendResponse(event, context, 'FAILED', responseData);
    return;
  }

  console.log('DirectoryId: ' + dId);
  console.log('LogGroup: ' + lgName);

  const AWS = require('aws-sdk');
  AWS.config.apiVersions = {
    directoryservice: '2015-04-16'
  };

  const ds = new AWS.DirectoryService();

  switch (event.RequestType) {
    case 'Create':
      console.log('Calling: CreateLogSubscription...');
      params = {
        DirectoryId: dId,
        LogGroupName: lgName
      };
      ds.createLogSubscription(params, function(err, data) {
        if (err) {
          responseData = {Error: 'CreateLogSubscription call failed'};
          console.error('Error: ' + responseData.Error + ':\n', err);
          sendResponse(event, context, 'FAILED', responseData);
        }
        else {
          responseData = data;
          console.log('LogSubscription: ' + lgName + ' created');
          sendResponse(event, context, 'SUCCESS', responseData, lgName);
        }
      });
      break;

    case 'Update':
      console.log('Note: Update attempted, but a Directory Log Subscription does not support an update operation, so no actions will be taken');
      sendResponse(event, context, 'SUCCESS', dAlias);
      break;

    case 'Delete':
      console.log('Calling: DeleteLogSubscription...');
      params = {
        DirectoryId: dId
      };
      ds.deleteLogSubscription(params, function(err, data) {
        if (err) {
          responseData = {Error: 'DeleteLogSubscription call failed'};
          console.error('Error: ' + responseData.Error + ':\n', err);
          sendResponse(event, context, 'FAILED', responseData);
        }
        else {
          responseData = data;
          console.log('LogSubscription: deleted');
          sendResponse(event, context, 'SUCCESS', responseData);
        }
      });
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

  console.log('Response body:\n', responseBody);

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
    console.log('Status code: ' + response.statusCode);
    console.log('Status message: ' + response.statusMessage);
    context.done();
  });

  request.on('error', function(error) {
    console.log('send(..) failed executing https.request(..): ' + error);
    context.done();
  });

  request.write(responseBody);
  request.end();
}
