/**
* CrossAccountStackExport: A Lambda function that returns information about a single Stack Export which may be in another Account and/or Region.
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

const getExport = async (exportName, credentials) => {
  const cloudformation = (credentials) ? new AWS.CloudFormation({accessKeyId: credentials.AccessKeyId,
                                                                 secretAccessKey: credentials.SecretAccessKey,
                                                                 sessionToken: credentials.SessionToken})
                                       : new AWS.CloudFormation();

  let nextToken;
  do {
    const params = (nextToken) ? {NextToken: nextToken} : {};
    const data = await cloudformation.listExports(params).promise();
    //console.info(`- ListExports Data:\n${JSON.stringify(data, null, 2)}`);

    const e = data.Exports.find(e => e.Name === exportName);
    if (e) {
      return e.Value;
    }
    else {
      if (data.NextToken) {
        nextToken = data.NextToken;
      }
      else {
        throw new Error(`Could not find ${exportName} Export`);
      }
    }
  } while (nextToken);
};

const maxValueLength = 80; // Truncate export values to this length when displayed in CloudWatch Logs

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

        const exportName = event.ResourceProperties.ExportName;
        if (! exportName) {
          throw new Error(`ExportName missing`);
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

        console.info(`Calling: getExport...`);
        const exportValue = await getExport(exportName, credentials);
        const exportDisplayValue = (exportValue.length <= maxValueLength) ? exportValue : exportValue.toString().slice(0, maxValueLength - 3) + '...';
        console.info(`Export: ${exportName} (${exportDisplayValue})`);

        await response.send(event, context, response.SUCCESS, {}, exportValue);
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
