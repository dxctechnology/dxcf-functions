/**
* DomainName: A Lambda function which converts Identifier
* Names into corresponding Codes, then combines them into
* DomainNames which conform to Naming Conventions.
*
* The mapping tables in this file should be kept up-to-date
* as new Applications and Components are added.
**/

const companyNameToCode = {
  'Demo'          : 'demo',
  'DXC'           : 'dxc',
  'HLS'           : 'hls',
  'MJCConsulting' : 'mjc'
};

// Keep codes in alphabetical order to better see conflicts
const environmentNameToCode = {
  'Audit'       : 'a',
  'Build'       : 'b',
  'Core'        : 'c',
  'Development' : 'd',
  'Example'     : 'e',
  'Identity'    : 'i',
  'Log'         : 'l',
  'Management'  : 'm',
  'Production'  : 'p',
  'QA'          : 'q',
  'Recovery'    : 'r',
  'Staging'     : 's',
  'Testing'     : 't',
  'UAT'         : 'u'
};

exports.handler = function(event, context) {
  console.log('Request body:\n' + JSON.stringify(event));

  let responseData = {};
  let params = {};

  switch (event.RequestType) {
    case 'Create':
    case 'Update':
      let parentDomainName = event.ResourceProperties.ParentDomainName;
      if (! /^([A-Za-z0-9][A-Za-z0-9-]{0,61}[A-Za-z0-9]?\.)+[A-Za-z]{2,6}$/.test(parentDomainName)) {
        responseData = {Error: 'ParentDomainName invalid'};
        console.error('Error: ' + responseData.Error);
        sendResponse(event, context, 'FAILED', responseData);
        return;
      }
      let companyCode = companyNameToCode[event.ResourceProperties.CompanyName];
      if (! companyCode) {
        responseData = {Error: 'CompanyName invalid: Not found in code lookup table'};
        console.error('Error: ' + responseData.Error);
        sendResponse(event, context, 'FAILED', responseData);
        return;
      }
      let locationName = (event.ResourceProperties.LocationName) ? event.ResourceProperties.LocationName : process.env.AWS_REGION;
      if (! /^(us-east-1|us-east-2|us-west-1|us-west-2|ca-central-1|eu-west-1|eu-central-1|eu-west-2|eu-west-3|ap-southeast-1|ap-southeast-2|ap-northeast-2|ap-northeast-1|ap-south-1|sa-east-1)$/.test(locationName)) {
        responseData = {Error: 'LocationName invalid: Must be an AWS Region code'};
        console.error('Error: ' + responseData.Error);
        sendResponse(event, context, 'FAILED', responseData);
        return;
      }
      let environmentCode = environmentNameToCode[event.ResourceProperties.EnvironmentName];
      if (! environmentCode) {
        responseData = {Error: 'EnvironmentName invalid: Not found in code lookup table'};
        console.error('Error: ' + responseData.Error);
        sendResponse.send(event, context, 'FAILED', responseData);
        return;
      }

      let domainName = ((environmentCode == 'p') ? '' : environmentCode + '.') + locationName + '.' + companyCode + '.' + parentDomainName;
      console.log('DomainName: ' + domainName);
      sendResponse(event, context, 'SUCCESS', responseData, domainName);
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
