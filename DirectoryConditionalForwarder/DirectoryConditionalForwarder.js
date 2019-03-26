/**
* DirectoryConditionalForwarder: A Lambda function that manages a
* Conditional Forwarder for a directory service.
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

  let domain = event.ResourceProperties.Domain;
  if (! /^[a-z][-.a-z0-9]*$/.test(domain)) {
    responseData = {Error: 'Domain invalid: must be a valid DNS Domain'};
    console.error('Error: ' + responseData.Error);
    sendResponse(event, context, 'FAILED', responseData);
    return;
  }

  let vpcCidrBlock = event.ResourceProperties.VpcCidrBlock;
  if (! /^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])(\/(1[6-9]|2[0-7]))$/.test(vpcCidrBlock) && event.RequestType != 'Delete') {
    responseData = {Error: 'VpcNetwork invalid: must be a valid Network CIDR, of the form xx.xx.xx.xx/yy'};
    console.error('Error: ' + responseData.Error);
    sendResponse(event, context, 'FAILED', responseData);
    return;
  }

  console.log('DirectoryId: ' + dId);
  console.log('Domain: ' + domain);
  console.log('VpcCidrBlock: ' + vpcCidrBlock);

  console.log('Calculating: AmazonProvidedDNS Address...');
  let vpcAddress = vpcCidrBlock.split('/')[0];
  let vpcOctets = vpcAddress.split('.');
  let vpcDecimal = ((((((+vpcOctets[0])  * 256)
                 +      (+vpcOctets[1])) * 256)
                 +      (+vpcOctets[2])) * 256)
                 +      (+vpcOctets[3]);

  let dnsDecimal = vpcDecimal + 2;
  let dnsAddress = (dnsDecimal >>> 24)       + '.'
                 + (dnsDecimal >>  16 & 255) + '.'
                 + (dnsDecimal >>   8 & 255) + '.'
                 + (dnsDecimal        & 255);

  console.log('DnsAddress: ' + dnsAddress);

  const AWS = require('aws-sdk');
  AWS.config.apiVersions = {
    directoryservice: '2015-04-16'
  };

  const ds = new AWS.DirectoryService();

  switch (event.RequestType) {
    case 'Create':
      console.log('Calling: CreateConditionalForwarder...');
      params = {
        DirectoryId: dId,
        DnsIpAddrs: [ dnsAddress ],
        RemoteDomainName: domain
      };
      ds.createConditionalForwarder(params, function(err, data) {
        if (err) {
          responseData = {Error: 'CreateConditionalForwarder call failed'};
          console.error('Error: ' + responseData.Error + ':\n', err);
          sendResponse(event, context, 'FAILED', responseData);
        }
        else {
          responseData = data;
          console.log('ConditionalForwarder: ' + domain + ' created');

          sendResponse(event, context, 'SUCCESS', responseData, domain);
        }
      });
      break;

    case 'Update':
      console.log('Calling: UpdateConditionalForwarder...');
      params = {
        DirectoryId: dId,
        DnsIpAddrs: [ dnsAddress ],
        RemoteDomainName: domain
      };

      ds.updateConditionalForwarder(params, function(err, data) {
        if (err) {
          responseData = {Error: 'UpdateConditionalForwarder call failed'};
          console.error('Error: ' + responseData.Error + ':\n', err);
          sendResponse(event, context, 'FAILED', responseData);
        }
        else {
          responseData = data;
          console.log('ConditionalForwarder: ' + domain + ' updated');

          sendResponse(event, context, 'SUCCESS', responseData, domain);
        }
      });
      break;

    case 'Delete':
      console.log('Calling: DeleteConditionalForwarder...');
      params = {
        DirectoryId: dId,
        RemoteDomainName: domain
      };
      ds.deleteConditionalForwarder(params, function(err, data) {
        if (err) {
          responseData = {Error: 'DeleteConditionalForwarder call failed'};
          console.error('Error: ' + responseData.Error + ':\n', err);
          sendResponse(event, context, 'FAILED', responseData);
        }
        else {
          responseData = data;
          console.log('ConditionalForwarder: ' + domain + ' deleted');

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
