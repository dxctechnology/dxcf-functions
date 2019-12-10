/**
* DirectoryLogSubscription: A Lambda function that manages a
* Log Subscription for a directory service.
**/

const response = require('cfn-response-promise');

const AWS = require('aws-sdk');
AWS.config.apiVersions = {
  directoryservice: '2015-04-16'
};

const ds = new AWS.DirectoryService();

const createLogSubscription = async (directoryId, logGroupName) => {
  const params = {
    DirectoryId: directoryId,
    LogGroupName: logGroupName
  };
  const data = await ds.createLogSubscription(params).promise();
  //console.info(`- CreateLogSubscription Data:\n${JSON.stringify(data, null, 2)}`);

  return;
};

const deleteLogSubscription = async (directoryId) => {
  const params = {
    DirectoryId: directoryId
  };
  const data = await ds.deleteLogSubscription(params).promise();
  //console.info(`- DeleteLogSubscription Data:\n${JSON.stringify(data, null, 2)}`);

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

        const logGroupName = event.ResourceProperties.LogGroup;
        if (! /^[-/0-9a-zA-Z]{5,64}$/.test(logGroupName)) {
          throw new Error(`LogGroup invalid: must be a valid LogGroup Name, consisting of aphanumeric characters, slashes and dashes`);
        }

        console.info(`DirectoryId: ${directoryId}`);
        console.info(`LogGroup: ${logGroupName}`);

        console.info('Calling: createLogSubscription...');
        await createLogSubscription(directoryId, logGroupName);

        console.info(`LogSubscription: ${logGroupName} created`);
        await response.send(event, context, response.SUCCESS, {}, logGroupName);
      }
      catch (err) {
        const responseData = {Error: `${(err.code) ? err.code : 'Error'}: ${err.message}`};
        console.error(responseData.Error);
        await response.send(event, context, response.FAILED, responseData);
      }
      break;

    case 'Update':
      console.info(`Update attempted, but a Directory Log Subscription does not support an update operation, so no actions will be taken`);
      await response.send(event, context, response.SUCCESS);
      break;

    case 'Delete':
      try {
        const directoryId = event.ResourceProperties.DirectoryId;
        if (! /^d-[0-9a-f]{10}$/.test(directoryId)) {
          throw new Error(`DirectoryId invalid: must be a valid Directory Id of the form d-9999999999, or "d-" followed by 10 hex digits`);
        }

        console.info(`DirectoryId: ${directoryId}`);

        console.info(`Calling: deleteLogSubscription...`);
        await deleteLogSubscription(directoryId);

        console.info(`LogSubscription: deleted`);
        await response.send(event, context, response.SUCCESS);
      }
      catch (err) {
        const responseData = {Error: `${(err.code) ? err.code : 'Error'}: ${err.message}`};
        console.error(responseData.Error);
        await response.send(event, context, response.FAILED, responseData);
      }
  }
};
