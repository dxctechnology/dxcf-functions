/**
* CrossAccountDomainNameServers: A Lambda proxy function that calls another Lambda management function to update NameServers in a Route53 Domain in another
* Account.
**/

exports.handler = function(event, context) {
  console.log('Request body:\n' + JSON.stringify(event));

  let responseData = {};
  let params = {};

  let region = (event.ResourceProperties.Region) ? event.ResourceProperties.Region : process.env.AWS_REGION;

  let accountId = (event.ResourceProperties.AccountId) ? event.ResourceProperties.AccountId : context.invokedFunctionArn.split(':')[4];

  let domainName = event.ResourceProperties.DomainName;
  if (! domainName) {
    responseData = {Error: 'DomainName missing'};
    console.error('Error: ' + responseData.Error);
    sendResponse(event, context, 'FAILED', responseData);
    return;
  }
  domainName = domainName.endsWith('.') ? domainName : domainName + '.';

  let nameServers = event.ResourceProperties.NameServers;
  if (! nameServers) {
    responseData = {Error: 'NameServers missing'};
    console.error('Error: ' + responseData.Error);
    sendResponse(event, context, 'FAILED', responseData);
    return;
  }
  nameServers = nameServers.map(ns => ns.endsWith('.') ? ns : ns + '.');

  let roleArn = 'arn:aws:iam::' + accountId + ':role/CrossAccountDomainNameServersRole';
  let functionName = 'DomainNameServers';

  const AWS = require('aws-sdk');
  AWS.config.update({region: region});
  AWS.config.apiVersions = {
    sts: '2011-06-15',
    lambda: '2015-03-31'
  };

  const sts = new AWS.STS();

  switch (event.RequestType) {
    case 'Create':
    case 'Update':
      console.log('Calling: AssumeRole...');
      params = {
        RoleArn: roleArn,
        RoleSessionName: 'DomainNameServersSession'
      };
      sts.assumeRole(params, function(err, data) {
        if (err) {
          responseData = {Error: 'AssumeRole call failed'};
          console.error('Error: ' + responseData.Error + ':\n', err);
          sendResponse(event, context, 'FAILED', responseData);
        }
        else {
          console.log('Role: ' + roleArn + ' assumed');
          const lambda = new AWS.Lambda({accessKeyId: data.Credentials.AccessKeyId,
                                         secretAccessKey: data.Credentials.SecretAccessKey,
                                         sessionToken: data.Credentials.SessionToken});

          console.log('Calling: Invoke[' + functionName + ']...');
          params = {
            FunctionName: functionName,
            Payload: JSON.stringify(event)
          };
          lambda.invoke(params, function(err, data) {
            if (err) {
              responseData = {Error: 'Invoke call failed'};
              console.error('Error: ' + responseData.Error + ':\n', err);
              sendResponse(event, context, 'FAILED', responseData);
            }
            else {
              console.log('Invoke succeeeded');
              try {
                let payload = JSON.parse(data.Payload);
                console.log('payload: [' + payload + ']');

                let responseBody = JSON.parse(payload);

                if (responseBody.Status == 'SUCCESS') {
                  const physicalResourceId = responseBody.PhysicalResourceId;
                  console.log('Domain NameServers: ' + physicalResourceId);
                  sendResponse(event, context, 'SUCCESS', responseData, physicalResourceId);
                }
                else {
                  responseData = responseBody.data;
                  console.error('Error: ' + responseData.Error);
                  sendResponse(event, context, 'FAILED', responseData);
                }
              }
              catch (err) {
                responseData = {Error: 'Could not parse Payload'};
                console.error('Error: ' + responseData.Error + ':\n', err);
                sendResponse(event, context, 'FAILED', responseData);
              }
            }
          });
        }
      });
      break;

    case 'Delete':
      console.log('Note: Delete attempted, but Domain NameServers can not be removed, only updated, so no actions will be taken');
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
