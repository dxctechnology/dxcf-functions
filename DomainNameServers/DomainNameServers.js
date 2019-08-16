/**
* DomainNameServers: A Lambda function that Updates NameServers for a Route53 Domain
*
* This function is meant to be called direct from a same-account CustomResource,
* or indirect via the CrossAccountDomainNameServers proxy Lambda from a
* different account CustomResource.
**/

exports.handler = function(event, context) {
  console.info('Request body:\n' + JSON.stringify(event));

  let responseData = {};
  let params = {};

  let domainName = event.ResourceProperties.DomainName;
  if (! domainName) {
    responseData = {Error: 'DomainName missing!'};
    console.error('Error: ' + responseData.Error);
    sendResponse(event, context, 'FAILED', responseData);
    return;
  }

  let nameServers = event.ResourceProperties.NameServers;
  if (! nameServers) {
    responseData = {Error: 'NameServers missing'};
    console.error('Error: ' + responseData.Error);
    sendResponse(event, context, 'FAILED', responseData);
    return;
  }

  console.info('DomainName: ' + domainName);
  console.info('NameServers: ' + nameServers);

  const AWS = require('aws-sdk');
  AWS.config.update({region: 'us-east-1'}); // Global service only available in us-east-1
  AWS.config.apiVersions = {
    route53domains: '2014-05-15'
  };

  const route53domains = new AWS.Route53Domains();

  switch (event.RequestType) {
    case 'Create':
    case 'Update':
      console.info('Calling: UpdateDomainNameservers...');
      params = {
        DomainName: domainName,
        Nameservers: [{ Name: nameServers[0] },
                      { Name: nameServers[1] },
                      { Name: nameServers[2] },
                      { Name: nameServers[3] }]
      };
      route53domains.updateDomainNameservers(params, function(err, data) {
        if (err) {
          responseData = {Error: 'UpdateDomainNameservers call failed'};
          console.error('Error: ' + responseData.Error + ':\n', err);
          sendResponse(event, context, 'FAILED', responseData);
        }
        else {
          let physicalResourceId = domainName + '[' + nameServers.toString() + ']';
          console.info('Domain NameServers: ' + physicalResourceId);
          sendResponse(event, context, 'SUCCESS', responseData, physicalResourceId);
        }
      });
      break;

    case 'Delete':
      console.info('Note: Delete attempted, but Domain NameServers can not be removed, only updated, so no actions will be taken');
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

  let srcAccountId = event.ServiceToken.split(':')[4];
  let dstAccountId = event.ResourceProperties.AccountId;

  // This function can be called direct by CloudFormation within the same Account,
  // Or via a Lambda proxy function in another Account, for Multi-Account integration
  if (! dstAccountId || dstAccountId == srcAccountId) {
    console.info('Invoked by current Account: Responding to CloudFormation');

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
  else {
    console.info('Invoked by Account ' + srcAccountId + ': Responding to Lambda');
    context.succeed(responseBody);
  }
}
