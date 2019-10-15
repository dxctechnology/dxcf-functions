/**
* CrossAccountStackExports: A Lambda function that returns information about all Exports created by a Stack which may be in another Account and/or Region.
**/

const response = require('cfn-response-promise');

const AWS = require('aws-sdk');
AWS.config.apiVersions = {
  sts: '2011-06-15',
  cloudformation: '2010-05-15'
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

const getStackExports = async (stackName, credentials) => {
  const cloudformation = (credentials) ? new AWS.CloudFormation({accessKeyId: credentials.AccessKeyId,
                                                                 secretAccessKey: credentials.SecretAccessKey,
                                                                 sessionToken: credentials.SessionToken})
                                       : new AWS.CloudFormation();

  const params = {
    StackName: stackName
  };
  const data = await cloudformation.describeStacks(params).promise();
  //console.info(`- DescribeStacks Data:\n${JSON.stringify(data, null, 2)}`);

  switch (data.Stacks.length) {
    case 0:
      throw new Error(`Could not find ${stackName} Stack`);
    case 1:
      return data.Stacks[0].Outputs.filter(o => o.hasOwnProperty('ExportName'))
                                    .map(o => ({Name: o.ExportName, Value: o.OutputValue}))
                                    .sort((x, y) => x.Name.localeCompare(y.Name));
    default:
      throw new Error(`Found multiple ${stackName} Stacks!`);
  }
};

exports.handler = async (event, context) => {
  console.info(`Request Body:\n${JSON.stringify(event)}`);

  switch (event.RequestType) {
    case 'Create':
    case 'Update':
      try {
        const region = event.ResourceProperties.Region || process.env.AWS_REGION;
        AWS.config.update({region: region});

        const currentAccountId = context.invokedFunctionArn.split(':')[4];
        const accountId = event.ResourceProperties.AccountId || currentAccountId;

        const stackName = event.ResourceProperties.StackName;
        if (! stackName) {
          throw new Error(`StackName missing`);
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

        console.info(`Calling: getStackExports...`);
        const exports = await getStackExports(stackName, credentials);
        console.info(`Exports:\n${exports.map(e => `- Name: "${e.Name}", Value: "${e.Value}"`).join('\n')}`);

        const responseData = {};
        exports.filter(e => {responseData[e.Name] = e.Value; return false;});

        await response.send(event, context, response.SUCCESS, responseData);
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
