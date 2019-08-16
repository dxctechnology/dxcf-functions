/**
* CrossAccountHostedZoneDelegation: A Lambda proxy function that calls another Lambda management function to create Sub-Domain delegation records in a Route53
* HostedZone in another Account.
**/

exports.handler = function(event, context) {
  console.info('Request body:\n' + JSON.stringify(event));

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

  let roleArn = 'arn:aws:iam::' + accountId + ':role/CrossAccountHostedZoneDelegationRole';
  let functionName = 'HostedZoneDelegation';

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
    case 'Delete':
      console.info('Calling: AssumeRole...');
      params = {
        RoleArn: roleArn,
        RoleSessionName: 'HostedZoneDelegationSession'
      };
      sts.assumeRole(params, function(err, data) {
        if (err) {
          responseData = {Error: 'AssumeRole call failed'};
          console.error('Error: ' + responseData.Error + ':\n', err);
          sendResponse(event, context, 'FAILED', responseData);
        }
        else {
          console.info('Role: ' + roleArn + ' assumed');
          const lambda = new AWS.Lambda({accessKeyId: data.Credentials.AccessKeyId,
                                         secretAccessKey: data.Credentials.SecretAccessKey,
                                         sessionToken: data.Credentials.SessionToken});

          console.info('Calling: Invoke[' + functionName + ']...');
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
              console.info('Invoke succeeeded');
              try {
                let payload = JSON.parse(data.Payload);
                console.info('payload: [' + payload + ']');

                let responseBody = JSON.parse(payload);

                if (responseBody.Status == 'SUCCESS') {
                  const physicalResourceId = responseBody.PhysicalResourceId;
                  console.info('HostedZone Delegation: ' + physicalResourceId);
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
