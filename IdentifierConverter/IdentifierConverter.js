/**
* IdentifierConverter: A Lambda function which converts Identifier
* Names into corresponding Codes and Lower Case variants, for use
* in constructing Names within CloudFormation Templates.
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

const locationNameToCode = {
  'us-east-1'       : 'ue1',
  'us-east-2'       : 'ue2',
  'us-west-1'       : 'uw1',
  'us-west-2'       : 'uw2',
  'ca-central-1'    : 'cc1',
  'eu-west-1'       : 'ew1',
  'eu-central-1'    : 'ec1',
  'eu-west-2'       : 'ew2',
  'eu-west-3'       : 'ew3',
  'eu-north-1'      : 'en1',
  'ap-southeast-1'  : 'as1',
  'ap-southeast-2'  : 'as2',
  'ap-northeast-2'  : 'an2',
  'ap-northeast-1'  : 'an1',
  'ap-south-1'      : 'ad1',
  'sa-east-1'       : 'se1',
  'Atlanta'         : 'atl',
  'Boston'          : 'bos',
  'Charlotte'       : 'clt',
  'Chicago'         : 'chi',
  'ColoradoSprings' : 'cos',
  'Dallas'          : 'dfw',
  'Denver'          : 'den',
  'Houston'         : 'hou',
  'KansasCity'      : 'mkc',
  'LasVegas'        : 'las',
  'LosAngeles'      : 'lax',
  'Miami'           : 'mia',
  'Minneapolis'     : 'msp',
  'NewYork'         : 'nyc',
  'Phoenix'         : 'phx',
  'Portland'        : 'pdx',
  'Raleigh'         : 'rdu',
  'SanFrancisco'    : 'sfo',
  'SanJose'         : 'sjc',
  'SantaBarbara'    : 'sba',
  'Seattle'         : 'sea',
  'Tulsa'           : 'tul',
  'Washington'      : 'was'
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

const systemNameToCode = {
  'Prototype' : 'proto',
  'Analytics' : 'anal'
};

// Keep codes in alphabetical order to better see conflicts
const applicationNameToCode = {
  'Acunetix'                : 'acu',
  'ActiveDirectory'         : 'ad',
  'DirectoryService'        : 'adm',
  'AutoSys'                 : 'as',
  'LinuxBastion'            : 'bl',
  'LinuxBastions'           : 'bl',
  'WindowsBastion'          : 'bw',
  'WindowsBastions'         : 'bw',
  'CentralDatabase'         : 'cdb',
  'DeepSecurity'            : 'ds',
  'DataTransfer'            : 'dt',
  'Duo'                     : 'duo',
  'Engine'                  : 'eng',
  'FederatedSecurity'       : 'fs',
  'SFTP'                    : 'ftp',
  'GitHubEnterprise'        : 'git',
  'Hadoop'                  : 'had',
  'LegalSolutionsSuite'     : 'lss',
  'LinuxWebServer'          : 'lws',
  'LinuxWebServers'         : 'lwsm',
  'LinuxWebServersNested'   : 'lwsmn',
  'LinuxWebServerNested'    : 'lwsn',
  'Magento'                 : 'mag',
  'MongoDB'                 : 'mdb',
  'Nessus'                  : 'nes',
  'Octopus'                 : 'oct',
  'PAX'                     : 'pax',
  'RiskMasterAccelerator'   : 'rma',
  'RabbitMQ'                : 'rmq',
  'RStudio'                 : 'rs',
  'ServiceDeskPlus'         : 'sdp',
  'SiteScope'               : 'ss',
  'Tableau'                 : 'tab',
  'Talend'                  : 'tal',
  'TikiWiki'                : 'tw',
  'Vertica'                 : 'v',
  'Vormetric'               : 'vor',
  'OpenVPN'                 : 'vpn',
  'OpenVPNAS'               : 'vpn',
  'WebSphereMQ'             : 'wmq',
  'WindowsWebServer'        : 'wws',
  'WindowsWebServers'       : 'wwsm',
  'WindowsWebServersNested' : 'wwsmn',
  'WindowsWebServerNested'  : 'wwsn'
};

// Keep codes in alphabetical order to better see conflicts
const componentNameToCode = {
  'Ambari'                : 'a',
  'AccessGateway'         : 'ag',
  'AccessServer'          : 'as',
  'Calculation'           : 'c',
  'Data'                  : 'd',
  'Deploy'                : 'd',
  'Database'              : 'db',
  'AuroraDatabase'        : 'dba',
  'MySQLDatabase'         : 'dbm',
  'OracleDatabase'        : 'dbo',
  'PostgreSQLDatabase'    : 'dbp',
  'SQLServerDatabase'     : 'dbs',
  'DomainController'      : 'dc',
  'DataStaging'           : 'ds',
  'DataSecurityManager'   : 'dsm',
  'Enterprise'            : 'e',
  'Executor'              : 'e',
  'SFTP'                  : 'ft',
  'Logging'               : 'l',
  'LoadBalancer'          : 'lb',
  'Manager'               : 'm',
  'Master'                : 'm',
  'Monitoring'            : 'm',
  'ManagementConsole'     : 'mc',
  'ManagementWorkstation' : 'mc',
  'Professional'          : 'p',
  'Publishing'            : 'p',
  'PolicyServer'          : 'ps',
  'Queue'                 : 'q',
  'Server'                : 's',
  'SC'                    : 'sc',
  'SecurityServer'        : 'ss',
  'TokenizationServer'    : 'ts',
  'Update'                : 'u',
  'Web'                   : 'w',
  'Worker'                : 'w'
};

exports.handler = function(event, context) {
  console.info('Request body:\n' + JSON.stringify(event));

  let responseData = {};
  let params = {};

  switch (event.RequestType) {
    case 'Create':
    case 'Update':
      responseData.CompanyCode = companyNameToCode[event.ResourceProperties.CompanyName];
      if (! responseData.CompanyCode) {
        responseData.CompanyCode = '';
      }
      responseData.CompanyNameLowerCase = (! event.ResourceProperties.CompanyName) ? '' : event.ResourceProperties.CompanyName.toLowerCase();

      responseData.LocationCode = (! event.ResourceProperties.LocationName) ? locationNameToCode[process.env.AWS_REGION] : locationNameToCode[event.ResourceProperties.LocationName];
      if (! responseData.LocationCode) {
        responseData.LocationCode = '';
      }
      responseData.LocationNameLowerCase = (! event.ResourceProperties.LocationName) ? process.env.AWS_REGION : event.ResourceProperties.LocationName.toLowerCase();

      responseData.EnvironmentCode = environmentNameToCode[event.ResourceProperties.EnvironmentName];
      if (! responseData.EnvironmentCode) {
        responseData.EnvironmentCode = '';
      }
      responseData.EnvironmentNameLowerCase = (! event.ResourceProperties.EnvironmentName) ? '' : event.ResourceProperties.EnvironmentName.toLowerCase();

      responseData.SystemCode = systemNameToCode[event.ResourceProperties.SystemName];
      if (! responseData.SystemCode) {
        responseData.SystemCode = '';
      }
      responseData.SystemNameLowerCase = (! event.ResourceProperties.SystemName) ? '' : event.ResourceProperties.SystemName.toLowerCase();

      responseData.ApplicationCode = applicationNameToCode[event.ResourceProperties.ApplicationName];
      if (! responseData.ApplicationCode) {
        responseData.ApplicationCode = '';
      }
      responseData.ApplicationNameLowerCase = (! event.ResourceProperties.ApplicationName) ? '' : event.ResourceProperties.ApplicationName.toLowerCase();

      responseData.ComponentCode = componentNameToCode[event.ResourceProperties.ComponentName];
      if (! responseData.ComponentCode) {
        responseData.ComponentCode = '';
      }
      responseData.ComponentNameLowerCase = (! event.ResourceProperties.ComponentName) ? '' : event.ResourceProperties.ComponentName.toLowerCase();

      sendResponse(event, context, 'SUCCESS', responseData);
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
