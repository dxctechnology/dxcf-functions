/**
* VpcDefaultResourceTagger: A Lambda function that tags the default
* resources created along with a VPC, which are otherwise untagged.
**/

const response = require('cfn-response-promise');

const AWS = require('aws-sdk');
AWS.config.apiVersions = {
  ec2: '2016-11-15'
};

const ec2 = new AWS.EC2();

exports.handler = async (event, context) => {
  console.info(`Event:\n${JSON.stringify(event)}`);

  let params = {};
  switch (event.RequestType) {
    case 'Create':
    case 'Update':
      try {
        const vpcId = event.ResourceProperties.VpcId;
        if (! /^vpc-[0-9a-f]{17}$/.test(vpcId)) {
          throw new Error(`VpcId invalid: must be a valid VPC Id of the form vpc-99999999999999999, or "vpc-" followed by 17 hex digits`);
        }

        const vpcToken = event.ResourceProperties.VpcNameTagReplaceText || 'VPC';
        const rtbToken = event.ResourceProperties.RouteTableNameTagReplaceText || 'MainRouteTable';
        const aclToken = event.ResourceProperties.NetworkAclNameTagReplaceText || 'DefaultNetworkAcl';
        const sgToken = event.ResourceProperties.SecurityGroupNameTagReplaceText || 'DefaultSecurityGroup';

        const describePromises = [];

        console.info(`Calling: DescribeRouteTables...`);
        params = {
          Filters: [{ Name: 'vpc-id', Values: [vpcId] },
                    { Name: 'association.main', Values: ['true'] }]
        };
        describePromises.push(ec2.describeRouteTables(params).promise()
                                                             .then(data => data.RouteTables[0].RouteTableId));

        console.info(`Calling: DescribeNetworkAcls...`);
        params = {
          Filters: [{ Name: 'vpc-id', Values: [vpcId] },
                    { Name: 'default', Values: ['true'] }]
        };
        describePromises.push(ec2.describeNetworkAcls(params).promise()
                                                             .then(data => data.NetworkAcls[0].NetworkAclId));

        console.info(`Calling: DescribeSecurityGroups...`);
        params = {
          Filters: [{ Name: 'vpc-id', Values: [vpcId] },
                    { Name: 'group-name', Values: ['default'] }]
        };
        describePromises.push(ec2.describeSecurityGroups(params).promise()
                                                                .then(data => data.SecurityGroups[0].GroupId));

        console.info(`Calling: DescribeTags...`);
        params = {
          Filters: [{ Name: 'resource-id', Values: [vpcId] }]
        };
        describePromises.push(ec2.describeTags(params).promise()
                                                      .then(data => data.Tags.filter(tag => ! tag.Key.startsWith('aws:'))
                                                                             .map(tag => ({Key: tag.Key, Value: tag.Value}))));

        console.info(`Waiting: for Requests to complete...`);
        const describeResults = await Promise.all(describePromises);

        const rtbId = describeResults[0];
        const aclId = describeResults[1];
        const sgId = describeResults[2];
        const vpcTags = describeResults[3];

        const rtbTags = vpcTags.map(tag => (tag.Key == 'Name' ? {Key: tag.Key, Value: tag.Value.replace(vpcToken, rtbToken)} : {Key: tag.Key, Value: tag.Value}));
        const aclTags = vpcTags.map(tag => (tag.Key == 'Name' ? {Key: tag.Key, Value: tag.Value.replace(vpcToken, aclToken)} : {Key: tag.Key, Value: tag.Value}));
        const sgTags = vpcTags.map(tag => (tag.Key == 'Name' ? {Key: tag.Key, Value: tag.Value.replace(vpcToken, sgToken)} : {Key: tag.Key, Value: tag.Value}));

        console.info(`Main RouteTable: ${rtbId}`);
        console.info(`Default NetworkAcl: ${aclId}`);
        console.info(`Default SecurityGroup: ${sgId}`);

        console.info(`Main RouteTable Tags:\n${JSON.stringify(rtbTags)}`);
        console.info(`Default NetworkAcl Tags:\n${JSON.stringify(aclTags)}`);
        console.info(`Default SecurityGroup Tags:\n${JSON.stringify(sgTags)}`);

        const createPromises = [];

        console.info(`Calling: CreateTags (for Main RouteTable)...`);
        params = {
          Resources: [rtbId],
          Tags: rtbTags
        };
        createPromises.push(ec2.createTags(params).promise());

        console.info(`Calling: CreateTags (for Default NetworkAcl)...`);
        params = {
          Resources: [aclId],
          Tags: aclTags
        };
        createPromises.push(ec2.createTags(params).promise());

        console.info(`Calling: CreateTags (for Default SecurityGroup)...`);
        params = {
          Resources: [sgId],
          Tags: sgTags
        };
        createPromises.push(ec2.createTags(params).promise());

        console.info(`Waiting: for Requests to complete...`);
        await Promise.all(createPromises);

        console.info(`Success: Default Resources Tagged`);

        await response.send(event, context, response.SUCCESS);
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
