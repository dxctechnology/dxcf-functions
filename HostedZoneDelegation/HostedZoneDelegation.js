/**
* HostedZoneDelegation: A Lambda function that manages a sub-domain delegation
* for a HostedZone.
*
* This function is meant to be called direct from a same-account CustomResource,
* or indirect via the CrossAccountHostedZoneDelegation proxy Lambda from a
* different account CustomResource.
**/

exports.handler = function(event, context) {
  console.log('Request body:\n' + JSON.stringify(event));

  let responseData = {};
  let params = {};

  let domainName = event.ResourceProperties.DomainName;
  if (! domainName) {
    responseData = {Error: 'DomainName missing!'};
    console.error('Error: ' + responseData.Error);
    sendResponse(event, context, 'FAILED', responseData);
    return;
  }
  domainName = domainName.endsWith('.') ? domainName : domainName + '.';
  let parentDomainName = domainName.replace(/^[^.]*\./, '');

  let nameServers = event.ResourceProperties.NameServers;
  if (! nameServers) {
    responseData = {Error: 'NameServers missing'};
    console.error('Error: ' + responseData.Error);
    sendResponse(event, context, 'FAILED', responseData);
    return;
  }
  nameServers = nameServers.map(ns => ns.endsWith('.') ? ns : ns + '.');

  console.log('ParentDomainName: ' + parentDomainName.replace(/\.$/, ''));
  console.log('DomainName: ' + domainName.replace(/\.$/, ''));
  console.log('NameServers: [ ' + nameServers.map(ns => ns.replace(/\.$/, '')).join(', ') + ' ]');

  const AWS = require('aws-sdk');
  AWS.config.update({region: 'us-east-1'}); // Global service only available in us-east-1
  AWS.config.apiVersions = {
    route53: '2013-04-01'
  };

  const route53 = new AWS.Route53();

  switch (event.RequestType) {
    case 'Create':
    case 'Update':
      console.log('Calling: ListHostedZonesByName...');
      params = {
        MaxItems: '100'
      };
      route53.listHostedZonesByName(params, function(err, data) {
        if (err) {
          responseData = {Error: 'ListHostedZonesByName call failed'};
          console.error('Error: ' + responseData.Error + ':\n', err);
          sendResponse(event, context, 'FAILED', responseData);
        }
        else {
          let zone = data.HostedZones.filter(z => z.Name == parentDomainName && z.Config.PrivateZone == false)[0];
          if (zone) {
            console.log('Zone: ' + zone.Id.replace('/hostedzone/','') + ', Domain: ' + zone.Name.replace(/\.$/, ''));

            console.log('Calling: ChangeResourceRecordSets[UPSERT]...');
            let params = {
              HostedZoneId: zone.Id.replace('/hostedzone/',''),
              ChangeBatch: {
                Changes: [{
                  Action: "UPSERT",
                  ResourceRecordSet: {
                    Name: domainName,
                    Type: 'NS',
                    TTL: 3600,
                    ResourceRecords: [{ Value: nameServers[0] },
                                      { Value: nameServers[1] },
                                      { Value: nameServers[2] },
                                      { Value: nameServers[3] }]
                  }
                }]
              }
            };
            route53.changeResourceRecordSets(params, function(err, data) {
              if (err) {
                responseData = {Error: 'ChangeResourceRecordSets call failed'};
                console.error('Error: ' + responseData.Error + ':\n', err);
                sendResponse(event, context, 'FAILED', responseData);
              }
              else {
                let params = {
                  Id: data.ChangeInfo.Id.replace('/change/','')
                };
                console.log('ChangeId: ' + params.Id);

                let i = 0;
                let intervalTimer = setInterval(() => {
                  if (i++ < 12) {
                    console.log('Calling: GetChange[' + i + ']...');
                    route53.getChange(params, function(err, data) {
                      if (err) {
                        clearInterval(intervalTimer);
                        responseData = {Error: 'GetChange call failed'};
                        console.error('Error: ' + responseData.Error + ':\n', err);
                        sendResponse(event, context, 'FAILED', responseData);
                      }
                      else {
                        console.log('Status: ' + data.ChangeInfo.Status);
                        if (data.ChangeInfo.Status == 'INSYNC') {
                          clearInterval(intervalTimer);
                          const physicalResourceId = domainName.replace(/\.$/, '') + '[' + nameServers.map(ns => ns.replace(/\.$/, '')).toString() + ']';
                          console.log('HostedZoneDelegation: ' + physicalResourceId);
                          sendResponse(event, context, 'SUCCESS', responseData, physicalResourceId);
                        }
                      }
                    });
                  }
                  else {
                    clearInterval(intervalTimer);
                    responseData = {Error: 'ChangeResourceRecordSets did not succeed in within 120 seconds'};
                    console.error('Error: ' + responseData.Error + ':\n', err);
                    sendResponse(event, context, 'FAILED', responseData);
                  }
                }, 10000);
              }
            });
          }
          else {
            responseData = {Error: 'Could not find Public HostedZone for ' + parentDomainName.replace(/\.$/, '')};
            console.error('Error: ' + responseData.Error);
            sendResponse(event, context, 'FAILED', responseData);
          }
        }
      });
      break;

    case 'Delete':
      console.log('Calling: ListHostedZonesByName...');
      params = {
        MaxItems: '100'
      };
      route53.listHostedZonesByName(params, function(err, data) {
        if (err) {
          responseData = {Error: 'ListHostedZonesByName call failed'};
          console.error('Error: ' + responseData.Error + ':\n', err);
          sendResponse(event, context, 'FAILED', responseData);
        }
        else {
          let zone = data.HostedZones.filter(z => z.Name == parentDomainName && z.Config.PrivateZone == false)[0];
          if (zone) {
            console.log('Zone: ' + zone.Id.replace('/hostedzone/','') + ', Domain: ' + zone.Name.replace(/\.$/, ''));

            // We need to obtain the current list of NameServers, in case they were changed, as we can only delete
            // the NS record if we have an exact match, and we always want that to happen.
            console.log('Calling: listResourceRecordSets...');
            params = {
              HostedZoneId: zone.Id,
              MaxItems: '1000'
            };
            route53.listResourceRecordSets(params, function(err, data) {
              if (err) {
                responseData = {Error: 'ListResourceRecordSets call failed'};
                console.error('Error: ' + responseData.Error + ':\n', err);
                sendResponse(event, context, 'FAILED', responseData);
              }
              else {
                let domainNSRecordSet = data.ResourceRecordSets.filter(r => (r.Type == 'NS' && r.Name == domainName))[0];
                if (domainNSRecordSet) {
                  let domainNSTTL = domainNSRecordSet.TTL;
                  let domainNSValues = domainNSRecordSet.ResourceRecords.map(o => o.Value);
                  console.log('Calling: ChangeResourceRecordSets[DELETE]...');
                  let params = {
                    HostedZoneId: zone.Id.replace('/hostedzone/',''),
                    ChangeBatch: {
                      Changes: [{
                        Action: "DELETE",
                        ResourceRecordSet: {
                          Name: domainName,
                          Type: 'NS',
                          TTL: domainNSTTL,
                          ResourceRecords: [{ Value: domainNSValues[0] },
                                            { Value: domainNSValues[1] },
                                            { Value: domainNSValues[2] },
                                            { Value: domainNSValues[3] }]
                        }
                      }]
                    }
                  };
                  route53.changeResourceRecordSets(params, function(err, data) {
                    if (err) {
                      responseData = {Error: 'ChangeResourceRecordSets call failed'};
                      console.error('Error: ' + responseData.Error + ':\n', err);
                      sendResponse(event, context, 'FAILED', responseData);
                    }
                    else {
                      let params = {
                        Id: data.ChangeInfo.Id.replace('/change/','')
                      };
                      console.log('ChangeId: ' + params.Id);

                      let i = 0;
                      let intervalTimer = setInterval(() => {
                        if (i++ < 12) {
                          console.log('Calling: GetChange[' + i + ']...');
                          route53.getChange(params, function(err, data) {
                            if (err) {
                              clearInterval(intervalTimer);
                              responseData = {Warning: 'GetChange call failed - but still likely to succeed'};
                              console.error('Warning: ' + responseData.Warning + ':\n', err);
                              sendResponse(event, context, 'SUCCESS', responseData);
                            }
                            else {
                              console.log('Status: ' + data.ChangeInfo.Status);
                              if (data.ChangeInfo.Status == 'INSYNC') {
                                clearInterval(intervalTimer);
                                console.log('HostedZoneDelegation: Deleted');
                                sendResponse(event, context, 'SUCCESS');
                              }
                            }
                          });
                        }
                        else {
                          clearInterval(intervalTimer);
                          responseData = {Warning: 'ChangeResourceRecordSets did not succeed in within 120 seconds - but still likely to succeed'};
                          console.error('Warning: ' + responseData.Warning + ':\n', err);
                          sendResponse(event, context, 'SUCCESS', responseData);
                        }
                      }, 10000);
                    }
                  });
                }
                else {
                  responseData = {Info: 'Could not find NS RecordSet for ' + domainName.replace(/\.$/, '')};
                  console.log('Info: ' + responseData.Info);
                  sendResponse(event, context, 'SUCCESS', responseData);
                }
              }
            });
          }
          else {
            responseData = {Info: 'Could not find Public HostedZone for ' + parentDomainName.replace(/\.$/, '')};
            console.log('Info: ' + responseData.Info);
            sendResponse(event, context, 'SUCCESS', responseData);
          }
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

  let srcAccountId = event.ServiceToken.split(':')[4];
  let dstAccountId = event.ResourceProperties.AccountId;

  // This function can be called direct by CloudFormation within the same Account,
  // Or via a Lambda proxy function in another Account, for Multi-Account integration
  if (! dstAccountId || dstAccountId == srcAccountId) {
    console.log('Invoked by current Account: Responding to CloudFormation');

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
  else {
    console.log('Invoked by Account ' + srcAccountId + ': Responding to Lambda');
    context.succeed(responseBody);
  }
}
