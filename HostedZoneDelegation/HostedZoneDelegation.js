/**
* HostedZoneDelegation: A Lambda function that manages a sub-domain delegation
* for a HostedZone.
*
* This function is meant to be called direct from a same-account CustomResource,
* or indirect via the CrossAccountHostedZoneDelegation proxy Lambda from a
* different account CustomResource.
**/

const response = require('cfn-response-promise');

const AWS = require('aws-sdk');
AWS.config.update({region: 'us-east-1'}); // Global service only available in us-east-1
AWS.config.apiVersions = {
  route53: '2013-04-01'
};

const route53 = new AWS.Route53();

const getPrivateHostedZoneId = async (domainName) => {
  const params = {
    MaxItems: '100'
  };
  const data = await route53.listHostedZonesByName(params).promise();
  //console.info(`- ListHostedZonesByName Data:\n${JSON.stringify(data, null, 2)}`);

  const hostedZones = data.HostedZones.filter(z => z.Name == domainName && z.Config.PrivateZone == false);

  return (hostedZones) ? hostedZones[0].Id.replace('/hostedzone/','') : undefined;
};

const getdomainNSRecordSet = async (hostedZoneId, domainName) => {
  const params = {
    HostedZoneId: hostedZoneId,
    MaxItems: '1000'
  };
  const data = await route53.listResourceRecordSets(params).promise();
  //console.info(`- ListResourceRecordSets Data:\n${JSON.stringify(data, null, 2)}`);

  const domainNSRecordSets = data.ResourceRecordSets.filter(r => (r.Type == 'NS' && r.Name == domainName));

  return (domainNSRecordSets) ? domainNSRecordSets[0] : undefined;
};

const constructNSUpsertChange = (name, nameServers, ttl = 3600) => {
  const action = 'UPSERT';
  const type = 'NS';

  return {
    Action: action,
    ResourceRecordSet: {
      Name: name,
      Type: type,
      TTL: ttl,
      ResourceRecords: [{ Value: nameServers[0] },
                        { Value: nameServers[1] },
                        { Value: nameServers[2] },
                        { Value: nameServers[3] }]
    }
  };
};

const constructDeleteChange = (record) => {
  const action = 'DELETE';

  return {
    Action: action,
    ResourceRecordSet: record
  };
};

const delay = async (ms) => {
  return await new Promise(resolve => setTimeout(resolve, ms));
};

const changeRecordSets = async (hostedZoneId, changes, interval = 10000, checks = 9) => {
  //console.info(`  - Changes: ${JSON.stringify(changes, null, 2)}`);

  let params = {
    HostedZoneId: hostedZoneId,
    ChangeBatch: {
      Changes: changes
    }
  };
  const data = await route53.changeResourceRecordSets(params).promise();

  params = {
    Id: data.ChangeInfo.Id.replace('/change/','')
  };
  console.info(`- Waiting for Change with ID ${params.Id} to synchronize...`);

  for (let i = 0; i < checks; i++) {
    const data = await route53.getChange(params).promise();

    console.info('  - Status: ' + data.ChangeInfo.Status);
    if (data.ChangeInfo.Status == 'INSYNC') {
      return;
    }
    await delay(interval);
  }

  throw new Error(`Change status was not 'INSYNC' within ${(checks * interval) / 1000} seconds`);
};

exports.handler = async (event, context) => {
  console.info(`Request Body:\n${JSON.stringify(event)}`);

  switch (event.RequestType) {
    case 'Create':
    case 'Update':
      try {
        let domainName = event.ResourceProperties.DomainName;
        if (! domainName) {
          throw new Error(`DomainName missing!`);
        }
        domainName = domainName.endsWith('.') ? domainName : domainName + '.';
        const parentDomainName = domainName.replace(/^[^.]*\./, '');

        let nameServers = event.ResourceProperties.NameServers;
        if (! nameServers) {
          throw new Error(`NameServers missing`);
        }
        nameServers = nameServers.map(ns => ns.endsWith('.') ? ns : ns + '.');

        console.info(`ParentDomainName: ${parentDomainName.replace(/\.$/, '')}`);
        console.info(`DomainName: ${domainName.replace(/\.$/, '')}`);
        console.info(`NameServers: [ ${nameServers.map(ns => ns.replace(/\.$/, '')).join(', ')} ]`);

        console.info(`Calling getPrivateHostedZoneId(${parentDomainName})...`);
        const hostedZoneId = await getPrivateHostedZoneId(parentDomainName);
        if (hostedZoneId) {
          console.info(`Zone: ${hostedZoneId}, Domain: ${parentDomainName}`);

          const changes = [];
          changes.push(constructNSUpsertChange(domainName, nameServers));

          console.info(`Calling changeRecordSets...`);
          await changeRecordSets(hostedZoneId, changes);

          const physicalResourceId = domainName.replace(/\.$/, '') + '[' + nameServers.map(ns => ns.replace(/\.$/, '')).toString() + ']';
          console.info('HostedZoneDelegation: ' + physicalResourceId);
          await response.send(event, context, response.SUCCESS, null, physicalResourceId);
        }
        else {
          throw new Error(`Could not find Public HostedZone for ${parentDomainName.replace(/\.$/, '')}`);
        }
      }
      catch (err) {
        const responseData = {Error: `${(err.code) ? err.code : 'Error'}: ${err.message}`};
        console.error(responseData.Error);
        await response.send(event, context, response.FAILED, responseData);
      }
      break;

    case 'Delete':
      try {
        let domainName = event.ResourceProperties.DomainName;
        if (! domainName) {
          throw new Error(`DomainName missing!`);
        }
        domainName = domainName.endsWith('.') ? domainName : domainName + '.';
        const parentDomainName = domainName.replace(/^[^.]*\./, '');

        console.info(`Calling getPrivateHostedZoneId(${parentDomainName})...`);
        const hostedZoneId = await getPrivateHostedZoneId(parentDomainName);
        if (hostedZoneId) {
          console.info(`Zone: ${hostedZoneId}, Domain: ${parentDomainName}`);

          // We need to obtain the current NS RecordSet, in case name servers were changed.
          // We can only delete the NS record if we have an exact match, and we always want that to succeed.
          console.info(`Calling getdomainNSRecordSet(${hostedZoneId}, ${domainName})...`);
          const domainNSRecordSet = await getdomainNSRecordSet(hostedZoneId, domainName);
          if (domainNSRecordSet) {
            const changes = [];
            changes.push(constructDeleteChange(domainNSRecordSet));

            console.info(`Calling changeRecordSets...`);
            await changeRecordSets(hostedZoneId, changes);

            console.info(`HostedZoneDelegation: Deleted`);
            await response.send(event, context, response.SUCCESS);
          }
          else {
            const responseData = {Info: `Could not find NS RecordSet for ${domainName.replace(/\.$/, '')}`};
            console.info(responseData.Info);
            await response.send(event, context, response.SUCCESS, responseData);
          }
        }
        else {
          const responseData = {Info: `Could not find Public HostedZone for ${parentDomainName.replace(/\.$/, '')}`};
          console.info(responseData.Info);
          await response.send(event, context, response.SUCCESS, responseData);
        }
      }
      catch (err) {
        if (err.message.startsWith(`Change status was not 'INSYNC'`)) {
          const responseData = {Warning: `${err.message} - but still likely to succeed`};
          console.error(responseData.Warning);
          await response.send(event, context, response.SUCCESS, responseData);
        }
        const responseData = {Error: `${(err.code) ? err.code : 'Error'}: ${err.message}`};
        console.error(responseData.Error);
        await response.send(event, context, response.FAILED, responseData);
      }
  }
};
