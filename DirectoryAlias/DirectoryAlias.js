/**
* DirectoryAlias: A Lambda function that manages an alias for
* a directory service.
**/

const response = require('cfn-response-promise');

const AWS = require('aws-sdk');
AWS.config.apiVersions = {
  directoryservice: '2015-04-16'
};

const ds = new AWS.DirectoryService();

const createAlias = async (directoryId, directoryAlias) => {
  const params = {
    DirectoryId: directoryId,
    Alias: directoryAlias
  };
  const data = await ds.createAlias(params).promise();
  //console.info(`- CreateAlias Data:\n${JSON.stringify(data, null, 2)}`);

  return;
};

const enableSso = async (directoryId) => {
  const params = {
    DirectoryId: directoryId
  };
  const data = await ds.enableSso(params).promise();
  //console.info(`- EnableSso Data:\n${JSON.stringify(data, null, 2)}`);

  return;
};

exports.handler = async (event, context) => {
  console.info(`Request Body:\n${JSON.stringify(event)}`);

  switch (event.RequestType) {
    case 'Create':
      try {
        const directoryId = event.ResourceProperties.DirectoryId;
        if (! /^d-[0-9a-f]{10}$/.test(directoryId)) {
          throw new Error(`DirectoryId invalid: must be a valid Directory Id of the form d-9999999999, or "d-" followed by 10 hex digits`);
        }

        const directoryAlias = event.ResourceProperties.DirectoryAlias;
        if (! /^[a-z][-0-9a-z]{4,64}$/.test(directoryAlias)) {
          throw new Error(`DirectoryAlias invalid: must be a valid Directory Alias, starting with a lower-case letter, consisting of lower-case aphanumeric characters and dashes`);
        }

        const enableSsoProperty = (/^(true|yes|1)$/i).test(event.ResourceProperties.EnableSso);

        console.info(`DirectoryId: ${directoryId}`);
        console.info(`DirectoryAlias: ${directoryAlias}`);
        console.info(`EnableSso: ${enableSsoProperty}`);

        console.info(`Calling: createAlias...`);
        await createAlias(directoryId, directoryAlias);
        console.info(`Alias: ${directoryAlias} created`);

        if (enableSsoProperty) {
          console.info(`Calling: enableSso...`);
          await enableSso(directoryId);
          console.info(`Enabled: SSO`);
        }

        await response.send(event, context, response.SUCCESS, {}, directoryAlias);
      }
      catch (err) {
        const responseData = {Error: `${(err.code) ? err.code : 'Error'}: ${err.message}`};
        console.error(responseData.Error);
        await response.send(event, context, response.FAILED, responseData);
      }
      break;

    case 'Update':
      console.info(`Update attempted, but a Directory Alias can not be removed or modified after it has been created, so no actions will be taken`);
      await response.send(event, context, response.SUCCESS);
      break;

    case 'Delete':
      console.info(`Delete attempted, but a Directory Alias can not be removed or modified after it has been created, so no actions will be taken`);
      await response.send(event, context, response.SUCCESS);
  }
};
