/**
* RoleReference: A Lambda function that returns information about an IAM Role in another Region and/or Account.
**/

const response = require('cfn-response-promise');

const AWS = require('aws-sdk');
AWS.config.update({region: 'us-east-1'}); // Global
AWS.config.apiVersions = {
  sts: '2011-06-15',
  iam: '2010-05-08'
};

const assumeRole = async (roleArn, roleSessionName) => {
  const sts = new AWS.STS();

  const params = {
    RoleArn: roleArn,
    RoleSessionName: roleSessionName
  };
  const data = await sts.assumeRole(params).promise();
  //console.info(`- AssumeRole Data:\n${JSON.stringify(data, null, 2)}`);

  return data.Credentials;
};

const getRoleByName = async (roleName, credentials) => {
  const iam = (credentials) ? new AWS.IAM({accessKeyId: credentials.AccessKeyId,
                                           secretAccessKey: credentials.SecretAccessKey,
                                           sessionToken: credentials.SessionToken})
                            : new AWS.IAM();

  const params = {
    RoleName: roleName
  };
  const data = await iam.getRole(params).promise();
  //console.info(`- GetRole Data:\n${JSON.stringify(data, null, 2)}`);

  if (data.Role) {
    return data.Role;
  }
  else {
    throw new Error(`Could not find ${roleName} Role`);
  }
};

exports.handler = async (event, context) => {
  console.info(`Request Body:\n${JSON.stringify(event)}`);

  switch (event.RequestType) {
    case 'Create':
    case 'Update':
      try {
        const currentAccountId = context.invokedFunctionArn.split(':')[4];
        const accountId = event.ResourceProperties.AccountId || currentAccountId;

        const roleNameProperty = event.ResourceProperties.RoleName;
        if (! roleNameProperty) {
          throw new Error(`RoleName missing`);
        }

        let credentials;
        if (accountId != currentAccountId) {
          const roleName = 'ReferenceRole';
          const roleArn = `arn:aws:iam::${accountId}:role/${roleName}`;
          const roleSessionName = 'AccountInformationSession';

          console.info(`Calling: assumeRole...`);
          credentials = await assumeRole(roleArn, roleSessionName);
          console.info(`Role: ${roleArn} assumed`);
        }

        console.info(`Calling: getRoleByName...`);
        const role = await getRoleByName(roleNameProperty, credentials);
        console.info(`Role: ${roleNameProperty} (${role.Arn})`);

        const responseData = {
          Arn: role.Arn,
          RoleId: role.RoleId
        };
        await response.send(event, context, response.SUCCESS, responseData, role.RoleName);
      }
      catch (err) {
        const responseData = {Error: `${(err.code) ? err.code : 'Error'}: ${err.message}`};
        console.error(responseData.Error);
        await response.send(event, context, response.FAILED, responseData);
      }
      break;

    case 'Delete':
      await response.send(event, context, response.SUCCESS);
  }
};
