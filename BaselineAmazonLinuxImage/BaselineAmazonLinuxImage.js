/**
 ** BaselineAmazonLinuxImage: A Lambda function that looks up the Baseline Amazon Linux Image
 **  for a given OS Variant and Region.A Lambda function that manages RecordSets
 **
 ** This function is the logic behind a CustomResource, and is meant to be called from CloudFormation.
 **
 **/

const response = require('cfn-response-promise');

const AWS = require('aws-sdk');
AWS.config.update({region: region});
AWS.config.apiVersions = {
  ec2: '2016-11-15'
};

const ec2 = new AWS.EC2();
let responseData = {};

const osNameToFilter = {
  'Amazon Linux' : 'Baseline Amazon Linux' // List default first
};

exports.handler = async (event, context) => {
  console.debug(`Event:\n${JSON.stringify(event)}`);

  const accountId = (event.ResourceProperties.AccountId) ? event.ResourceProperties.AccountId : context.invokedFunctionArn.split(':')[4];
  const region = (event.ResourceProperties.Region) ? event.ResourceProperties.Region : process.env.AWS_REGION;
  const osName = (event.ResourceProperties.OSName) ? event.ResourceProperties.OSName : Object.keys(osNameToFilter)[0];

  let amiNameFilter = (! osNameToFilter[osName]) ? osNameToFilter[Object.keys(osNameToFilter)[0]] : osNameToFilter[osName];
  amiNameFilter += '-*';
  console.debug(`OS: ${osName}`);
  console.debug(`Filter: ${amiNameFilter}`);

  switch (event.RequestType) {
    case 'Create':
    case 'Update':
      try {
        console.debug('Calling: DescribeImages...');
        const params = {
          Filters: [{ Name: 'name', Values: [amiNameFilter] }],
          Owners: [accountId]
        };
        const data = await ec2.describeImages(params).promise();

        if (data.Images.length > 0) {
          const image = data.Images.sort((x, y) => y.CreationDate.localeCompare(x.CreationDate))[0];
          responseData.Name = image.Name;
          responseData.CreationDate = image.CreationDate;
          console.info(`Image: ${image.Name} Image (${image.ImageId})`);
          await response.send(event, context, response.SUCCESS, responseData, image.ImageId);
        }
        else {
          responseData = {Error: `Could not find Image(s) matching pattern ${amiNameFilter}`};
          console.error(`Error: ${responseData.Error}`);
          await response.send(event, context, response.FAILED, responseData);
        }
      }
      catch (err) {
        responseData = {Error: `DescribeImages call failed`};
        console.error(`Error: ${responseData.Error}:\n${err}`);
        await response.send(event, context, response.FAILED, responseData);
      }
      break;

    case 'Delete':
      await response.send(event, context, response.SUCCESS);
      break;

    default:
      responseData = {Error: `Unknown operation: ${event.RequestType}`};
      console.error(`Error: ${responseData.Error}`);
      await response.send(event, context, response.FAILED, responseData);
  }
};
