/**
 * KeyPair: A Lambda function that manages an EC2 Key Pair.
 **
 ** This Custom Resource imports an existing public key generated via the ssh-keygen program,
 ** via the following (recommended, our standard) command line:
 ** $ ssh-keygen -t rsa -b 4096 -C <username>@<domain> -f ~/.ssh/<companyCode>_<username>_id_rsa
 **
 ** The PublicKey must be in 'OpenSSH public key format'
 **/

const response = require('cfn-response-promise');

const AWS = require('aws-sdk');
AWS.config.apiVersions = {
  ec2: '2016-11-15'
};

const ec2 = new AWS.EC2();
let responseData = {};

const getKeyPair = async (keyName) => {
  console.debug(`Calling: DescribeKeyPairs for Key ${keyName}...`);
  const params = {
    Filters: [{ Name: 'key-name', Values: [keyName] }]
  }
  return await ec2.describeKeyPairs(params).promise().then(data => data.KeyPairs[0]);
};

const importKeyPair = async (keyName, publicKeyMaterial) => {
  console.debug(`Calling: ImportKeyPair for Key ${keyName}...`);

  const params = {
    KeyName: keyName,
    PublicKeyMaterial: publicKeyMaterial
  };
  return await ec2.importKeyPair(params).promise().then(data => data.KeyFingerprint);
};

const deleteKeyPair = async (keyName) => {
  console.debug(`Calling: DeleteKeyPair for Key ${keyName}...`);
  const params = {
    KeyName: keyName
  };
  await ec2.deleteKeyPair(params).promise();
};

exports.handler = async (event, context) => {
  console.debug(`Event:\n${JSON.stringify(event)}`);

  const keyName = event.ResourceProperties.KeyName;
  if (! /^[a-z][a-z0-9]{3,63}$/.test(keyName)) {
    responseData = {Error: `KeyName invalid: must be a 4 - 64-character string which starts with a lower-case letter and consists of lower-case letters and digits`};
    console.error(`Error: ${responseData.Error}`);
    await response.send(event, context, response.FAILED, responseData);
    return;
  }

  const publicKey = event.ResourceProperties.PublicKey;
  if (! /^ssh-rsa AAAAB3NzaC1yc2E[=/+A-Za-z0-9]{701}( .*)?$/.test(publicKey)) {
    responseData = {Error: `PublicKey invalid: Key is not in valid OpenSSH public key format`};
    console.error(`Error: ${responseData.Error}`);
    await response.send(event, context, response.FAILED, responseData);
    return;
  }

  console.debug(`KeyName: ${keyName}`);
  console.debug(`PublicKey: ${pubicKey}`);

  switch (event.RequestType) {
    case 'Create':
    case 'Update':
      try {
        const keyPair = await getKeyPair(keyName);

        if (keyPair) {
          await deleteKeyPair(keyName);
        }

        const fingerprint = await importKeyPair(keyName, publicKey);

        console.info(`KeyPair: ${keyName} with fingerprint ${fingerprint} ${(keyPair) ? 'created' : 'updated'}`);
        await response.send(event, context, response.SUCCESS, responseData, fingerprint);
      }
      catch (err) {
        responseData = {Error: `Could not ${(event.RequestType) ? 'create' : 'update'} KeyPair`};
        console.error(`Error: ${responseData.Error}:\n${err}`);
        await response.send(event, context, response.FAILED, responseData);
      }
      break;

    case 'Delete':
      try {
        const keyPair = await getKeyPair(keyName);

        if (keyPair) {
          await deleteKeyPair(keyName);
        }

        const fingerprint = keyPair.KeyFingerprint;

        console.info(`KeyPair: ${keyName} with fingerprint ${fingerprint} ${(keyPair) ? 'created' : 'updated'}`);
        await response.send(event, context, response.SUCCESS, responseData, fingerprint);
      }
      catch (err) {
        responseData = {Error: `Could not ${(event.RequestType) ? 'create' : 'update'} KeyPair`};
        console.error(`Error: ${responseData.Error}:\n${err}`);
        await response.send(event, context, response.FAILED, responseData);
      }
      break;

    default:
      responseData = {Error: `Unknown operation: ${event.RequestType}`};
      console.error(`Error: ${responseData.Error}`);
      await response.send(event, context, response.FAILED, responseData);
  }
};
