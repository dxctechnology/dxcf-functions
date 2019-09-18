/**
* DomainNameServersProxy: A Lambda proxy function that calls another Lambda management function to update NameServers
* in a Route53 Domain in another Account.
**/

const response = require('cfn-response-promise');

const AWS = require('aws-sdk');
AWS.config.update({region: 'us-east-1'}); // Global
AWS.config.apiVersions = {
  sts: '2011-06-15',
  lambda: '2015-03-31'
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

const invokeCustomResourceFunction = async (credentials, functionName, event) => {
  const lambda = new AWS.Lambda({accessKeyId: credentials.AccessKeyId,
                                 secretAccessKey: credentials.SecretAccessKey,
                                 sessionToken: credentials.SessionToken});

  const params = {
    FunctionName: functionName,
    Payload: JSON.stringify(event)
  };
  const data = await lambda.invoke(params).promise();
  //console.info(`- Invoke Data:\n${JSON.stringify(data, null, 2)}`);

  return data.Payload;
};

exports.handler = async (event, context) => {
  console.info(`Request Body:\n${JSON.stringify(event)}`);

  switch (event.RequestType) {
    case 'Create':
    case 'Update':
      try {
        const accountId = event.ResourceProperties.AccountId || context.invokedFunctionArn.split(':')[4];

        let domainName = event.ResourceProperties.DomainName;
        if (! domainName) {
          throw new Error(`DomainName missing!`);
        }
        domainName = domainName.endsWith('.') ? domainName : domainName + '.';

        let nameServers = event.ResourceProperties.NameServers;
        if (! nameServers) {
          throw new Error(`NameServers missing`);
        }
        nameServers = nameServers.map(ns => ns.endsWith('.') ? ns : ns + '.');

        const roleName = 'DomainNameServersProxyRole';
        const roleArn = `arn:aws:iam::${accountId}:role/${roleName}`;
        const roleSessionName = 'DomainNameServersSession';
        const functionName = 'DomainNameServers';

        console.info(`Calling: assumeRole...`);
        const credentials = await assumeRole(roleArn, roleSessionName);
        console.info(`Role: ${roleArn} assumed`);

        console.info(`Calling: invokeCustomResourceFunction...`);
        const payload = await invokeCustomResourceFunction(credentials, functionName, event);
        console.info(`Invoke succeeeded`);

        const parsedPayload = JSON.parse(payload);
        console.info(`Payload: ${JSON.stringify(parsedPayload)}`);

        const responseBody = JSON.parse(parsedPayload);

        if (responseBody.Status == 'SUCCESS') {
          const physicalResourceId = responseBody.PhysicalResourceId;
          console.info(`Domain NameServers: ${physicalResourceId}`);
          await response.send(event, context, response.SUCCESS, {}, physicalResourceId);
        }
        else {
          const responseData = responseBody.data;
          console.error(responseData.Error);
          await response.send(event, context, response.FAILED, responseData);
        }
      }
      catch (err) {
        const responseData = {Error: `${(err.code) ? err.code : 'Error'}: ${err.message}`};
        console.error(responseData.Error);
        await response.send(event, context, response.FAILED, responseData);
      }
      break;

    case 'Delete':
      console.info(`Delete attempted, but Domain NameServers can not be removed, only updated, so no actions will be taken`);
      await response.send(event, context, response.SUCCESS);
  }
};
