/**
* VpcReference: A Lambda function that returns information about an EC2 VPC in another Region and/or Account.
**/

const response = require('cfn-response-promise');

const AWS = require('aws-sdk');
AWS.config.apiVersions = {
  sts: '2011-06-15',
  ec2: '2016-11-15'
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

const getVpcByNameTag = async (vpcNameTagValue, credentials) => {
  const ec2 = (credentials) ? new AWS.EC2({accessKeyId: credentials.AccessKeyId,
                                           secretAccessKey: credentials.SecretAccessKey,
                                           sessionToken: credentials.SessionToken})
                            : new AWS.EC2();

  const params = {
    Filters: [{Name: 'tag:Name', Values: [ vpcNameTagValue ]}]
  };
  const data = await ec2.describeVpcs(params).promise();
  //console.info(`- DescribeVpcs Data:\n${JSON.stringify(data, null, 2)}`);

  switch (data.Vpcs.length) {
    case 0:
      throw new Error(`Could not find ${vpcNameTagValue} VPC`);
    case 1:
      return data.Vpcs[0];
    default:
      throw new Error(`Found multiple ${vpcNameTagValue} VPCs!`);
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

        const vpcName = event.ResourceProperties.VpcName;
        if (! vpcName) {
          throw new Error(`VpcName missing`);
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

        console.info(`Calling: getVpcByNameTag...`);
        const vpc = await getVpcByNameTag(vpcName, credentials);
        console.info(`VPC: ${vpcName} (${vpc.VpcId})`);

        const responseData = {
          CidrBlock: vpc.CidrBlock
        };
        await response.send(event, context, response.SUCCESS, responseData, vpc.VpcId);
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
