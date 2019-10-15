/**
* DirectoryConditionalForwarder: A Lambda function that manages a
* Conditional Forwarder for a directory service.
**/

const response = require('cfn-response-promise');

const AWS = require('aws-sdk');
AWS.config.apiVersions = {
  directoryservice: '2015-04-16'
};

const ds = new AWS.DirectoryService();

const createConditionalForwarder = async (directoryId, remoteDomainName, dnsAddress) => {
  const params = {
    DirectoryId: directoryId,
    RemoteDomainName: remoteDomainName,
    DnsIpAddrs: [ dnsAddress ]
  };
  const data = await ds.createConditionalForwarder(params).promise();
  //console.info(`- CreateConditionalForwarder Data:\n${JSON.stringify(data, null, 2)}`);

  return;
};

const updateConditionalForwarder = async (directoryId, remoteDomainName, dnsAddress) => {
  const params = {
    DirectoryId: directoryId,
    RemoteDomainName: remoteDomainName,
    DnsIpAddrs: [ dnsAddress ]
  };
  const data = await ds.updateConditionalForwarder(params).promise();
  //console.info(`- UpdateConditionalForwarder Data:\n${JSON.stringify(data, null, 2)}`);

  return;
};

const deleteConditionalForwarder = async (directoryId, remoteDomainName) => {
  const params = {
    DirectoryId: directoryId,
    RemoteDomainName: remoteDomainName
  };
  const data = await ds.deleteConditionalForwarder(params).promise();
  //console.info(`- DeleteConditionalForwarder Data:\n${JSON.stringify(data, null, 2)}`);

  return;
};

exports.handler = async (event, context) => {
  console.info(`Request Body:\n${JSON.stringify(event)}`);

  let directoryId;
  let remoteDomainName;
  let dnsAddress;

  try {
    directoryId = event.ResourceProperties.DirectoryId;
    if (! /^d-[0-9a-f]{10}$/.test(directoryId)) {
      throw new Error(`DirectoryId invalid: must be a valid Directory Id of the form d-9999999999, or "d-" followed by 10 hex digits`);
    }

    remoteDomainName = event.ResourceProperties.RemoteDomainName;
    if (! /^[a-z][-.a-z0-9]*$/.test(remoteDomainName)) {
      throw new Error(`RemoteDomainName invalid: must be a valid DNS Domain`);
    }

    console.info(`DirectoryId: ${directoryId}`);
    console.info(`RemoteDomainName: ${remoteDomainName}`);

    if (event.RequestType != 'Delete') {
      const vpcCidrBlock = event.ResourceProperties.VpcCidrBlock;
      if (! /^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])(\/(1[6-9]|2[0-7]))$/.test(vpcCidrBlock)) {
        throw new Error(`VpcNetwork invalid: must be a valid Network CIDR, of the form xx.xx.xx.xx/yy`);
      }

      console.info(`VpcCidrBlock: ${vpcCidrBlock}`);

      console.info('Calculating: AmazonProvidedDNS Address...');
      const vpcAddress = vpcCidrBlock.split('/')[0];
      const vpcOctets = vpcAddress.split('.');
      const vpcDecimal = ((((((+vpcOctets[0])  * 256)
                       +      (+vpcOctets[1])) * 256)
                       +      (+vpcOctets[2])) * 256)
                       +      (+vpcOctets[3]);

      const dnsDecimal = vpcDecimal + 2;
      dnsAddress = (dnsDecimal >>> 24)       + '.'
                 + (dnsDecimal >>  16 & 255) + '.'
                 + (dnsDecimal >>   8 & 255) + '.'
                 + (dnsDecimal        & 255);

      console.info(`DnsAddress: ${dnsAddress}`);
    }
  }
  catch (err) {
    const responseData = {Error: `${(err.code) ? err.code : 'Error'}: ${err.message}`};
    console.error(responseData.Error);
    await response.send(event, context, response.FAILED, responseData);
  }

  switch (event.RequestType) {
    case 'Create':
      try {
        console.info(`Calling: createConditionalForwarder...`);
        await createConditionalForwarder(directoryId, remoteDomainName, dnsAddress);
        console.info(`ConditionalForwarder: ${remoteDomainName} created`);

        await response.send(event, context, response.SUCCESS, {}, remoteDomainName);
      }
      catch (err) {
        const responseData = {Error: `${(err.code) ? err.code : 'Error'}: ${err.message}`};
        console.error(responseData.Error);
        await response.send(event, context, response.FAILED, responseData);
      }
      break;

    case 'Update':
      try {
        console.info(`Calling: updateConditionalForwarder...`);
        await updateConditionalForwarder(directoryId, remoteDomainName, dnsAddress);
        console.info(`ConditionalForwarder: ${remoteDomainName} updated`);

        await response.send(event, context, response.SUCCESS, {}, remoteDomainName);
      }
      catch (err) {
        const responseData = {Error: `${(err.code) ? err.code : 'Error'}: ${err.message}`};
        console.error(responseData.Error);
        await response.send(event, context, response.FAILED, responseData);
      }
      break;

    case 'Delete':
      try {
        console.info(`Calling: deleteConditionalForwarder...`);
        await deleteConditionalForwarder(directoryId, remoteDomainName);
        console.info(`ConditionalForwarder: ${remoteDomainName} deleted`);

        await response.send(event, context, response.SUCCESS);
      }
      catch (err) {
        const responseData = {Error: `${(err.code) ? err.code : 'Error'}: ${err.message}`};
        console.error(responseData.Error);
        await response.send(event, context, response.FAILED, responseData);
      }
  }
};
