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

const getKeyPair = async (keyName) => {
  console.info(`Calling: DescribeKeyPairs for Key ${keyName}...`);
  const params = {
    Filters: [{ Name: 'key-name', Values: [keyName] }]
  }
  return await ec2.describeKeyPairs(params).promise().then(data => data.KeyPairs[0]);
};

const importKeyPair = async (keyName, publicKeyMaterial) => {
  console.info(`Calling: ImportKeyPair for Key ${keyName}...`);
  const params = {
    KeyName: keyName,
    PublicKeyMaterial: publicKeyMaterial
  };
  return await ec2.importKeyPair(params).promise().then(data => data.KeyFingerprint);
};

const deleteKeyPair = async (keyName) => {
  console.info(`Calling: DeleteKeyPair for Key ${keyName}...`);
  const params = {
    KeyName: keyName
  };
  await ec2.deleteKeyPair(params).promise();
};

exports.handler = async (event, context) => {
  console.info(`Event:\n${JSON.stringify(event)}`);

  switch (event.RequestType) {
    case 'Create':
    case 'Update':
      try {
        const keyName = event.ResourceProperties.KeyName;
        if (! /^[a-z][a-z0-9]{3,63}$/.test(keyName)) {
          throw new Error(`KeyName invalid: must be a 4 - 64-character string which starts with a lower-case letter and consists of lower-case letters and digits`);
        }

        const publicKey = event.ResourceProperties.PublicKey;
        if (! /^ssh-rsa AAAAB3NzaC1yc2E[=/+A-Za-z0-9]{701}( .*)?$/.test(publicKey)) {
          throw new Error(`PublicKey invalid: Key is not in valid OpenSSH public key format`);
        }

        console.info(`KeyName: ${keyName}`);
        console.info(`PublicKey: ${publicKey}`);

        const keyPair = await getKeyPair(keyName);

        if (keyPair) {
          await deleteKeyPair(keyName);
        }

        const fingerprint = await importKeyPair(keyName, publicKey);
        const responseData = {Fingerprint: fingerprint};
        console.info(`KeyPair: ${keyName} with fingerprint ${fingerprint} ${(keyPair) ? 'created' : 'updated'}`);
        await response.send(event, context, response.SUCCESS, responseData, keyName);
      }
      catch (err) {
        const responseData = {Error: `${(err.code) ? err.code : 'Error'}: ${err.message}`};
        console.error(responseData.Error);
        await response.send(event, context, response.FAILED, responseData);
      }
      break;

    case 'Delete':
      try {
        const keyName = event.ResourceProperties.KeyName;
        if (! /^[a-z][a-z0-9]{3,63}$/.test(keyName)) {
          throw new Error(`KeyName invalid: must be a 4 - 64-character string which starts with a lower-case letter and consists of lower-case letters and digits`);
        }

        const keyPair = await getKeyPair(keyName);

        if (keyPair) {
          const fingerprint = keyPair.KeyFingerprint;
          await deleteKeyPair(keyName);
          console.info(`KeyPair: ${keyName} with fingerprint ${fingerprint} deleted`);
        }
        else {
          console.info(`KeyPair: ${keyName} not found`);
        }
        await response.send(event, context, response.SUCCESS);
      }
      catch (err) {
        const responseData = {Error: `${(err.code) ? err.code : 'Error'}: ${err.message}`};
        console.error(responseData.Error);
        await response.send(event, context, response.FAILED, responseData);
      }
  }
};
