/**
 ** PrivateRecordSet: A Lambda function that manages RecordSets
 **  in a private Route53 HostedZone.
 **
 ** This function is meant to be called via CloudWatch Events on EC2 Instance running & shutting-down events.
 **
 ** This enforces a specific HostName Naming Convention, which is required to make this technique work correctly.
 ** - See the get getHostNameRegExp function for details
 **
 **/

const AWS = require('aws-sdk');
AWS.config.apiVersions = {
  ec2: '2016-11-15',
  route53: '2013-04-01'
};

const ec2 = new AWS.EC2();
const route53 = new AWS.Route53();

const parseBoolean = (value) => {
  const re=/^(t(rue)?|1|on|y(es)?)$/i;
  return re.test(value);
};

const validateEvent = (event, source, detailType, states) => {
  if (! event) {
    throw new Error(`event invalid`);
  }
  if (! event.source || event.source != source) {
    throw new Error(`event.source ${event.source} invalid, expecting ${source}`);
  }
  if (! event['detail-type'] || event['detail-type'] != detailType) {
    throw new Error(`event.detail-type ${event['detail-type']} invalid, expecting ${detailType}`);
  }
  if (! event.detail || states.indexOf(event.detail.state) < 0) {
    throw new Error(`event.detail.state: ${event.detail.state} invalid, expecting one of ${states.join(', ')}`);
  }
};

const getInstance = async (instanceId) => {
  console.info(`- Calling: DescribeInstances for Instance ${instanceId}...`);
  const params = {
    InstanceIds: [ instanceId ]
  };
  const data = await ec2.describeInstances(params).promise();
  //console.info(`- DescribeInstances Data:\n${JSON.stringify(data, null, 2)}`);

  return data.Reservations[0].Instances[0];
};

const getInstanceByPrivateIpAddress = async (privateIpAddress) => {
  console.info(`- Calling: DescribeInstances with filter for Private IP ${privateIpAddress}...`);
  const params = {
    Filters: [{ Name: 'private-ip-address', Values: [ privateIpAddress ] }]
  };
  const data = await ec2.describeInstances(params).promise();
  //console.info(`- DescribeInstances Data:\n${JSON.stringify(data, null, 2)}`);

  return (data.Reservations.length > 0) ? data.Reservations[0].Instances[0] : undefined;
};

const getTagValue = (tags, tagName) => {
  const tag = tags.find(t => t.Key == tagName);
  return (tag) ? tag.Value : undefined;
};

const getHostNameRegExp = (availabilityZone, type = 'full') => {
  const companyCodePattern = '[a-z]{3}';
  const environmentCodePattern = '[abcdijlmopqrstu]';
  const applicationCodePattern = '[a-z]{2,5}';
  const instanceNumberPattern = '[0-9]{2}';

  let locationCode;
  switch (availabilityZone.slice(0, -1)) {
    case 'us-east-1': // US East (N. Virginia)
      locationCode = 'ue1';
      break;
    case 'us-east-2': // US East (Ohio)
      locationCode = 'ue2';
      break;
    case 'us-west-1': // US West (N. California)
      locationCode = 'uw1';
      break;
    case 'us-west-2': // US West (Oregon)
      locationCode = 'uw2';
      break;
    case 'ap-east-1': // Asia Pacific (Hong Kong)
      locationCode = 'ae1';
      break;
    case 'ap-south-1': // Asia Pacific (Mumbai)
      locationCode = 'id1'; // Note - difference from other code mappings
      break;
    case 'ap-northeast-2': // Asia Pacific (Seoul)
      locationCode = 'an2';
      break;
    case 'ap-southeast-1': // Asia Pacific (Singapore)
      locationCode = 'as1';
      break;
    case 'ap-southeast-2': // Asia Pacific (Sydney)
      locationCode = 'as2';
      break;
    case 'ap-northeast-1': // Asia Pacific (Tokyo)
      locationCode = 'an1';
      break;
    case 'ca-central-1': // Canada (Central)
      locationCode = 'cc1';
      break;
    case 'eu-central-1': // EU (Frankfurt)
      locationCode = 'ec1';
      break;
    case 'eu-west-1': // EU (Ireland)
      locationCode = 'ew1';
      break;
    case 'eu-west-2': // EU (London)
      locationCode = 'ew2';
      break;
    case 'eu-west-3': // EU (Paris)
      locationCode = 'ew3';
      break;
    case 'eu-north-1': // EU (Stockholm)
      locationCode = 'en1';
      break;
    case 'me-south-1': // Middle East (Bahrain)
      locationCode = 'ms1';
      break;
    case 'sa-east-1': // South America (Sao Paulo)
      locationCode = 'se1';
      break;
    default:
      throw new Error(`Region ${availabilityZone.slice(0, -1)} is unknown`);
  }

  const zoneCode = availabilityZone.slice(-1);

  switch (type) {
    case 'partial':
      return new RegExp(`^${companyCodePattern}${locationCode}${environmentCodePattern}${applicationCodePattern}$`);
    default: // full
      return new RegExp(`^${companyCodePattern}${locationCode}${environmentCodePattern}${applicationCodePattern}${instanceNumberPattern}${zoneCode}$`);
  }
};

const getSpecificHostNameRegExp = (hostName, availabilityZone, crossZone = false) => {
  const fullHostNameRegExp = getHostNameRegExp(availabilityZone);
  const partialHostNameRegExp = getHostNameRegExp(availabilityZone, 'partial');
  let hostNamePattern;

  if (fullHostNameRegExp.test(hostName)) {
    hostNamePattern = hostName.replace(/[0-9]{2}(?=[a-z]$)/, '[0-9]{2}');
  }
  else if (partialHostNameRegExp.test(hostName)) {
    hostNamePattern = `${hostName}[0-9]{2}${availabilityZone.slice(-1)}`;
  }
  else {
    throw new Error(`HostName ${hostName} is invalid: it does not conform to the naming convention, or is invalid for availability Zone ${availabilityZone}`);
  }

  if (crossZone) {
    return new RegExp(`^${hostNamePattern.slice(0,-1)}[a-z]$`);
  }
  else {
    return new RegExp(`^${hostNamePattern}$`);
  }
};

const validateHostName = (hostName, availabilityZone) => {
  const fullHostNameRegExp = getHostNameRegExp(availabilityZone);
  const partialHostNameRegExp = getHostNameRegExp(availabilityZone, 'partial');

  if (fullHostNameRegExp.test(hostName)) {
    console.info(`- HostName ${hostName} is a full hostname valid for availability zone ${availabilityZone}`);
    return true;
  }
  else if (partialHostNameRegExp.test(hostName)) {
    console.info(`- HostName ${hostName} is a partial hostname valid for availability zone ${availabilityZone}`);
    return false;
  }
  else {
    throw new Error(`HostName ${hostName} is invalid: it does not conform to the naming convention, or is invalid for availability Zone ${availabilityZone}`);
  }
};

const getVpcPrivateHostedZoneId = async (vpcId) => {
  // As of August 2019, there is no faster way to get the ID of the Private HostedZone associated with a VPC
  console.info('- Calling: ListHostedZonesByName...');
  const params = {
    MaxItems: '100'
  };
  const data = await route53.listHostedZonesByName(params).promise();
  //console.info(`- listHostedZonesByName Data:\n${JSON.stringify(data, null, 2)}`);

  if (data.HostedZones.filter(z => z.Config.PrivateZone == true).length > 0) {
    const hostedZones = data.HostedZones.filter(z => z.Config.PrivateZone == true)
                                        .map(z => ({ Id: z.Id.replace('/hostedzone/',''), Name: z.Name}));
    //console.info(`- Private HostedZones:\n${JSON.stringify(hostedZones, null, 2)}`);
    console.info(`- Found ${hostedZones.length} Private HostedZones`);

    console.info(`- Calling: GetHostedZone for ${hostedZones.length} HostedZones...`);
    const getPromises = [];
    for (const hostedZone of hostedZones) {
      //console.info(`- Calling: GetHostedZone for Hosted Zone ${hostedZone.Id}...`);
      const params = {
        Id: hostedZone.Id
      };
      getPromises.push(route53.getHostedZone(params).promise());
    }

    console.info(`- Waiting for all GetHostedZone calls to finish...`);
    const results = await Promise.all(getPromises);
    //console.info(`- All Results:\n${JSON.stringify(results, null, 2)}`);

    return results.filter(r => r.VPCs.map(v => v.VPCId).filter(v => v == vpcId)[0])
                  .map(r => r.HostedZone.Id.replace('/hostedzone/',''))[0];
  }
  else {
    return undefined;
  }
};

const getRecordSets = async (hostedZoneId) => {
  console.info(`- Calling: ListResourceRecordSets for Hosted Zone ${hostedZoneId}...`);
  const params = {
    HostedZoneId: hostedZoneId,
    MaxItems: '1000'
  };
  const data = await route53.listResourceRecordSets(params).promise();
  //console.info(`- listResourceRecordSets Data:\n${JSON.stringify(data, null, 2)}`);

  return data.ResourceRecordSets;
};

const getDomainName = (recordSets) => {
  return recordSets.filter(r => r.Type == 'SOA')[0].Name.slice(0,-1);
};

const getHostNameRecordSets = (recordSets, hostName, domainName, availabilityZone) => {
  const specificHostNameRegExp = getSpecificHostNameRegExp(hostName, availabilityZone);

  return recordSets.filter(r => (r.Type == 'A' && specificHostNameRegExp.test(r.Name.replace(`.${domainName}.`, ''))));
};

const getRecordSetByName = (recordSets, hostName, domainName) => {
  const resultRecordSets = recordSets.filter(r => r.Name.replace(`.${domainName}.`, '') == hostName);

  switch (resultRecordSets.length) {
    case 0:
      return undefined;
    case 1:
      return resultRecordSets[0];
    default:
      throw new Error(`More than one RecordSet with HostName ${hostName} found (this should not be possible!)`);
  }
};

const getRecordSetByIpAddress = (recordSets, ipAddress) => {
  const resultRecordSets = recordSets.filter(r => r.ResourceRecords.find(rr => rr.Value == ipAddress));

  switch (resultRecordSets.length) {
    case 0:
      return undefined;
    case 1:
      if (resultRecordSets[0].ResourceRecords.length > 1) {
        throw new Error(`RecordSet with IP Address ${ipAddress} contains additional Values ${resultRecordSets[0].ResourceRecords.filter(rr => rr.Value != ipAddress).join(', ')}`);
      }
      return resultRecordSets[0];
    default:
      throw new Error(`More than one RecordSet with IP Address ${ipAddress} found (this should not be allowed, but may be possible)`);
  }
};

const getRecordSetHostName = (recordSet, domainName) => {
  return (recordSet) ? recordSet.Name.replace(`.${domainName}.`, '') : undefined;
};

const getRecordSetIpAddress = (recordSet) => {
  return (recordSet) ? recordSet.ResourceRecords[0].Value : undefined; // Assume A record with single IP Value
};

const getNextHostName = (hostNameRecordSets, domainName) => {
  const hostNames = (domainName) ? hostNameRecordSets.map(r => r.Name.replace(`.${domainName}.`, ''))
                                 : hostNameRecordSets.map(r => r.Name.split('.')[0]);

  if (hostNames.length > 0) {
    let lowestHostNumber = 0;
    let lowestHostName = hostNames.sort()[0].replace(/[0-9]{2}(?=[a-z]?$)/, `00${++lowestHostNumber}`.slice(-2));
    for (const hostName of hostNames.sort()) {
      if (lowestHostName < hostName) {
        break;
      }
      else {
        lowestHostName = lowestHostName.replace(/[0-9]{2}(?=[a-z]?$)/, `00${++lowestHostNumber}`.slice(-2));
      }
    }
    return lowestHostName;
  }
  else {
    throw new Error(`No RecordSets found`);
  }
};

const getFirstHostName = (hostName, availabilityZone) => {
  const fullHostNameRegExp = getHostNameRegExp(availabilityZone);
  const partialHostNameRegExp = getHostNameRegExp(availabilityZone, 'partial');

  if (fullHostNameRegExp.test(hostName)) {
    return hostName.replace(/[0-9]{2}(?=[a-z]$)/, '01');
  }
  else if (partialHostNameRegExp.test(hostName)) {
    return `${hostName}01${availabilityZone.slice(-1)}`;
  }
  else {
    throw new Error(`HostName ${hostName} is invalid: it does not conform to the naming convention, or is invalid for availability Zone ${availabilityZone}`);
  }
};

const constructCreateChange = (name, value) => {
  const action = 'CREATE';
  const type = 'A';
  const ttl = 300;

  console.info(`- Constructing CREATE Change [ Action: ${action}, Name: ${name}, Type: ${type}, TTL: ${ttl}, Value: ${value} ]`);

  return {
    Action: action,
    ResourceRecordSet: {
      Name: name,
      Type: type,
      TTL: ttl,
      ResourceRecords: [{ Value: value }]
    }
  };
};

const constructDeleteChange = (record) => {
  const action = 'DELETE';

  console.info(`- Constructing DELETE Change [ Action: ${action}, Name: ${record.Name}, Type: ${record.Type}, TTL: ${record.TTL}, Value: ${record.ResourceRecords.map(v => v.Value)} ]`);

  return {
    Action: action,
    ResourceRecordSet: record
  };
};

const constructUpsertChange = (record, value) => {
  const action = 'UPSERT';

  console.info(`- Constructing UPSERT Change [ Action: ${action}, Name: ${record.Name}, Type: ${record.Type}, TTL: ${record.TTL}, Value: ${value} ]`);

  return {
    Action: action,
    ResourceRecordSet: {
      Name: record.Name,
      Type: record.Type,
      TTL: record.TTL,
      ResourceRecords: [{ Value: value }]
    }
  };
};

const delay = async (ms) => {
  return await new Promise(resolve => setTimeout(resolve, ms));
};

const changeRecordSets = async (hostedZoneId, changes, interval = 10000, checks = 9) => {
  console.info(`- Calling: ChangeResourceRecordSets for Hosted Zone ${hostedZoneId}...`);
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

const pruneHostNameRecordSets = async (hostedZoneId, hostName, domainName, availabilityZone) => {
  const specificHostNameRegExp = getSpecificHostNameRegExp(hostName, availabilityZone, true);

  const recordSets = await getRecordSets(hostedZoneId);

  const hostNameRecordSets = recordSets.filter(r => (r.Type == 'A' && specificHostNameRegExp.test(r.Name.replace(`.${domainName}.`, ''))));
  //console.info(`- Pruning HostNameRecordSets:\n${JSON.stringify(hostNameRecordSets, null, 2)}`);

  if (hostNameRecordSets.length > 0) {
    console.info(`- Calling: DescribeInstances for ${hostNameRecordSets.length} HostName RecordSets...`);
    const getPromises = [];
    for (const hostNameRecordSet of hostNameRecordSets) {
      const privateIpAddress = getRecordSetIpAddress(hostNameRecordSet);
      //console.info(`- Calling: DescribeInstances with filter for Private IP ${privateIpAddress}...`);
      const params = {
        Filters: [{ Name: 'private-ip-address', Values: [ privateIpAddress ] }]
      };
      getPromises.push(ec2.describeInstances(params).promise());
    }

    console.info(`- Waiting for all DescribeInstances calls to finish...`);
    const results = await Promise.all(getPromises);
    //console.info(`- All Results:\n${JSON.stringify(results, null, 2)}`);

    const changes = [];
    for (let i = 0; i < results.length; i++) {
      if (results[i].Reservations.length == 0) {
        changes.push(constructDeleteChange(hostNameRecordSets[i]));
        console.info(i);
      }
    }

    if (changes.length > 0) {
      await changeRecordSets(hostedZoneId, changes);
    }
  }
};

exports.handler = async (event, context) => {
  console.info(`Event:\n${JSON.stringify(event)}`);

  const prune = parseBoolean(process.env.PRUNE);
  const test = parseBoolean(process.env.TEST);

  if (test) {
    console.info(`Test Mode: replace 3-letter CompanyCode at start of HostName tags with 'tst' to avoid changing actual RecordSets`);
  }

  console.info('Validating Event...');
  validateEvent(event, 'aws.ec2', 'EC2 Instance State-change Notification', [ 'running', 'stopped', 'shutting-down' ]);

  const instanceId = event.detail['instance-id'];
  console.info(`Obtaining Instance ${instanceId}...`);
  const instance = await getInstance(instanceId);
  const availabilityZone = instance.Placement.AvailabilityZone;
  const privateIpAddress = instance.PrivateIpAddress;
  const vpcId = instance.VpcId;
  let   hostName = getTagValue(instance.Tags, 'HostName');

  if (hostName) {
    if (test) {
      hostName = hostName.replace(/^.../, 'tst');
    }

    console.info(`HostName Tag found, validating Value ${hostName}...`);
    const hostNameIsFull = validateHostName(hostName, availabilityZone);

    console.info(`Obtaining Private HostedZone for VPC ${vpcId}...`);
    const hostedZoneId = await getVpcPrivateHostedZoneId(vpcId);

    if (hostedZoneId) {
      console.info(`VPC ${vpcId}, Private HostedZone ${hostedZoneId}`);
      console.info(`Instance ${instanceId} ${event.detail.state}, HostName ${hostName}, IP ${privateIpAddress}`);

      let changes = [];

      console.info(`Obtaining HostName Resource Records for Private HostedZone ${hostedZoneId}...`);
      const recordSets = await getRecordSets(hostedZoneId);
      const domainName = getDomainName(recordSets);
      const hostNameRecordSets = getHostNameRecordSets(recordSets, hostName, domainName, availabilityZone);
      let hostNameRecordSet;
      let hostNameRecordSetPrivateIpAddress;
      let privateIpRecordSet;
      let privateIpRecordSetHostName;

      if (hostNameRecordSets.length > 0) {
        console.info(`${hostNameRecordSets.length} HostName RecordSet(s) found`);
        //console.info(`Matching HostName RecordSets:\n${JSON.stringify(hostNameRecordSets, null, 2)}`);

        if (hostNameIsFull) {
          console.info(`Finding ResourceRecord for Exact HostName ${hostName}...`);
          hostNameRecordSet = getRecordSetByName(hostNameRecordSets, hostName, domainName);
          hostNameRecordSetPrivateIpAddress = getRecordSetIpAddress(hostNameRecordSet);
        }

        console.info(`Finding ResourceRecord for current IP ${privateIpAddress}...`);
        privateIpRecordSet = getRecordSetByIpAddress(hostNameRecordSets, privateIpAddress);
        privateIpRecordSetHostName = getRecordSetHostName(privateIpRecordSet);
      }

      switch (event.detail.state) {
        case 'running':
          if (hostNameRecordSet && privateIpRecordSet && hostNameRecordSet === privateIpRecordSet) {
            console.info(`RecordSet found: HostName ${hostName}, IP ${privateIpAddress} - NO ACTION (restart after stop)`);
          }
          else if ((hostNameRecordSet && ! privateIpRecordSet) ||
                   (hostNameRecordSet && privateIpRecordSet && hostNameRecordSet !== privateIpRecordSet)) {
            const otherInstance = await getInstanceByPrivateIpAddress(getRecordSetIpAddress(hostNameRecordSet));
            if (otherInstance) {
              throw new Error(`RecordSet found: HostName ${hostName}, IP ${hostNameRecordSetPrivateIpAddress} - NO ACTION (IP in use by another Instance! Unable to update existing RecordSet)`);
            }
            else {
              console.info(`RecordSet found: HostName ${hostName}, IP ${hostNameRecordSetPrivateIpAddress} - UPSERT (replacement Instance with modified IP)`);
              changes.push(constructUpsertChange(hostNameRecordSet, privateIpAddress));
            }
          }
          else if (! hostNameRecordSet && privateIpRecordSet) {
            console.info(`RecordSet found: HostName ${privateIpRecordSetHostName}, IP ${privateIpAddress} - NO ACTION (restart after stop, with HostName tag pattern)`);
          }
          else if (hostNameRecordSets.length > 0 && ! hostNameRecordSet && ! privateIpRecordSet) {
            const newHostName = getNextHostName(hostNameRecordSets);
            console.info(`RecordSet(s) found which match HostName tag pattern, but none which match current Instance IP - CREATE (new Instance)`);
            changes.push(constructCreateChange(`${newHostName}.${domainName}`, privateIpAddress));
          }
          else if (hostNameRecordSets.length == 0) {
            const newHostName = (hostNameIsFull) ? hostName : getFirstHostName(hostName, availabilityZone);
            console.info(`RecordSet(s) not found - CREATE (new Instance)`);
            changes.push(constructCreateChange(`${newHostName}.${domainName}`, privateIpAddress));
          }
          break;

        case 'stopped':
          if (! test) {
            console.info(`event.detail.state: stopped ignored, except in test mode`);
            break;
          }

        case 'shutting-down':
          if (hostNameRecordSet && privateIpRecordSet && hostNameRecordSet === privateIpRecordSet) {
            console.info(`RecordSet found: HostName ${hostName}, IP ${privateIpAddress} - DELETE`);
            changes.push(constructDeleteChange(hostNameRecordSet));
          }
          else if (! hostNameRecordSet && privateIpRecordSet) {
            console.info(`RecordSet found: HostName ${privateIpRecordSetHostName}, IP ${privateIpAddress} - DELETE`);
            changes.push(constructDeleteChange(privateIpRecordSet));
          }
          break;

        default:
          throw new Error(`event.detail.state: ${event.detail.state} invalid, expecting one of running, stopped, shutting-down`);
      }

      if (changes.length > 0) {
        await changeRecordSets(hostedZoneId, changes);
      }

      if (event.detail.state == 'shutting-down' && prune) {
        console.info(`Pruning HostName Resource Records for Private HostedZone ${hostedZoneId}...`);
        await pruneHostNameRecordSets(hostedZoneId, hostName, domainName, availabilityZone);
      }
    }
    else {
      console.info('Private HostedZone not associated with VPC');
    }
  }
  else {
    console.info('HostName tag not found');
  }

  return context.logStreamName;
};
