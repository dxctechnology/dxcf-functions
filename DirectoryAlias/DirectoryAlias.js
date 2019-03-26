/**
* DirectoryAlias: A Lambda function that manages an alias for
* a directory service.
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

  let dAlias = event.ResourceProperties.DirectoryAlias;
  if (! /^[a-z][-0-9a-z]{4,64}$/.test(dAlias) && event.RequestType != 'Delete') {
    responseData = {Error: 'DirectoryAlias invalid: must be a valid Directory Alias, starting with a lower-case letter, consisting of lower-case aphanumeric characters and dashes'};
    console.error('Error: ' + responseData.Error);
    sendResponse(event, context, 'FAILED', responseData);
    return;
  }

  let enableSso = (/^(true|yes|1)$/i).test(event.ResourceProperties.EnableSso);

  console.log('DirectoryId = ' + dId);
  console.log('DirectoryAlias = ' + dAlias);
  console.log('EnableSso = ' + enableSso);

  const AWS = require('aws-sdk');
  AWS.config.apiVersions = {
    directoryservice: '2015-04-16'
  };

  const ds = new AWS.DirectoryService();

  switch (event.RequestType) {
    case 'Create':
      console.log('Calling: CreateAlias...');
      params = {
        DirectoryId: dId,
        Alias: dAlias
      };
      ds.createAlias(params, function(err, data) {
        if (err) {
          responseData = {Error: 'CreateAlias call failed'};
          console.error('Error: ' + responseData.Error + ':\n', err);
          sendResponse(event, context, 'FAILED', responseData);
        }
        else {
          responseData = data;
          console.log('Alias: ' + dAlias + ' created');

          if (enableSso) {
            console.log('Calling: EnableSso...');
            params = {
              DirectoryId: dId
            };
            ds.enableSso(params, function(err, data) {
              if (err) {
                responseData = {Error: 'EnableSso call failed'};
                console.error('Error: ' + responseData.Error + ':\n', err);
                sendResponse(event, context, 'FAILED', responseData);
              }
              else {
                console.log('Enabled: SSO');
                sendResponse(event, context, 'SUCCESS', responseData, dAlias);
              }
            });
          }
          else {
            sendResponse(event, context, 'SUCCESS', responseData, dAlias);
          }
        }
      });
      break;

    case 'Update':
      console.log('Note: Update attempted, but a Directory Alias can not be removed or modified after it has been created, so no actions will be taken');
      sendResponse(event, context, 'SUCCESS', dAlias);
      break;

    case 'Delete':
      console.log('Note: Delete attempted, but a Directory Alias can not be removed or modified after it has been created, so no actions will be taken');
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
