/**
* VpcDefaultResourceTagger: A Lambda function that tags the default
* resources created along with a VPC, which are otherwise untagged.
**/

exports.handler = function(event, context) {
  console.info('Request body:\n' + JSON.stringify(event));

  let responseData = {};
  let params = {};

  switch (event.RequestType) {
    case 'Create':
    case 'Update':
      let vpcId = event.ResourceProperties.VpcId;
      if (! /^vpc-[0-9a-f]{17}$/.test(vpcId)) {
        responseData = {Error: 'VpcId invalid: must be a valid VPC Id of the form vpc-99999999999999999, or "vpc-" followed by 17 hex digits'};
        console.error('Error: ' + responseData.Error);
        sendResponse(event, context, 'FAILED', responseData);
        return;
      }

      let vpcToken = (event.ResourceProperties.VpcNameTagReplaceText) ? event.ResourceProperties.VpcNameTagReplaceText : 'VPC';
      let rtbToken = (event.ResourceProperties.RouteTableNameTagReplaceText) ? event.ResourceProperties.RouteTableNameTagReplaceText : 'MainRouteTable';
      let aclToken = (event.ResourceProperties.NetworkAclNameTagReplaceText) ? event.ResourceProperties.NetworkAclNameTagReplaceText : 'DefaultNetworkAcl';
      let sgToken = (event.ResourceProperties.SecurityGroupNameTagReplaceText) ? event.ResourceProperties.SecurityGroupNameTagReplaceText : 'DefaultSecurityGroup';

      const AWS = require('aws-sdk');
      AWS.config.apiVersions = {
        ec2: '2016-11-15'
      };

      const ec2 = new AWS.EC2();

      console.info('Calling: DescribeRouteTables...');
      params = {
        Filters: [{ Name: 'vpc-id', Values: [vpcId] },
                  { Name: 'association.main', Values: ['true'] }]
      };
      let rtbPromise = ec2.describeRouteTables(params).promise()
                                                      .then(data => data.RouteTables[0].RouteTableId);

      console.info('Calling: DescribeNetworkAcls...');
      params = {
        Filters: [{ Name: 'vpc-id', Values: [vpcId] },
                  { Name: 'default', Values: ['true'] }]
      };
      let aclPromise = ec2.describeNetworkAcls(params).promise()
                                                      .then(data => data.NetworkAcls[0].NetworkAclId);

      console.info('Calling: DescribeSecurityGroups...');
      params = {
        Filters: [{ Name: 'vpc-id', Values: [vpcId] },
                  { Name: 'group-name', Values: ['default'] }]
      };
      let sgPromise = ec2.describeSecurityGroups(params).promise()
                                                        .then(data => data.SecurityGroups[0].GroupId);

      console.info('Calling: DescribeTags...');
      params = {
        Filters: [{ Name: 'resource-id', Values: [vpcId] }]
      };
      let vpcTagsPromise = ec2.describeTags(params).promise()
                                                   .then(data => data.Tags.filter(tag => ! tag.Key.startsWith('aws:'))
                                                                          .map(tag => ({Key: tag.Key, Value: tag.Value})));

      console.info('Waiting: for Requests to complete...');
      Promise.all([rtbPromise, aclPromise, sgPromise, vpcTagsPromise])
             .then(results => {
        let rtbId = results[0];
        let aclId = results[1];
        let sgId = results[2];
        let vpcTags = results[3];

        let rtbTags = vpcTags.map(tag => (tag.Key == 'Name' ? {Key: tag.Key, Value: tag.Value.replace(vpcToken, rtbToken)} : {Key: tag.Key, Value: tag.Value}));
        let aclTags = vpcTags.map(tag => (tag.Key == 'Name' ? {Key: tag.Key, Value: tag.Value.replace(vpcToken, aclToken)} : {Key: tag.Key, Value: tag.Value}));
        let sgTags = vpcTags.map(tag => (tag.Key == 'Name' ? {Key: tag.Key, Value: tag.Value.replace(vpcToken, sgToken)} : {Key: tag.Key, Value: tag.Value}));

        console.info('Main RouteTable: ' + rtbId);
        console.info('Default NetworkAcl: ' + aclId);
        console.info('Default SecurityGroup: ' + sgId);

        console.info('Main RouteTable Tags: \n', rtbTags);
        console.info('Default NetworkAcl Tags: \n', aclTags);
        console.info('Default SecurityGroup Tags: \n', sgTags);

        console.info('Calling: CreateTags (for Main RouteTable)...');
        params = {
          Resources: [rtbId],
          Tags: rtbTags
        };
        let rtbCreateTagsPromise = ec2.createTags(params).promise();

        console.info('Calling: CreateTags (for Default NetworkAcl)...');
        params = {
          Resources: [aclId],
          Tags: aclTags
        };
        let aclCreateTagsPromise = ec2.createTags(params).promise();

        console.info('Calling: CreateTags (for Default SecurityGroup)...');
        params = {
          Resources: [sgId],
          Tags: sgTags
        };
        let sgCreateTagsPromise = ec2.createTags(params).promise();

        console.info('Waiting: for Requests to complete...');
        Promise.all([rtbCreateTagsPromise, aclCreateTagsPromise, sgCreateTagsPromise])
               .then(results => {
          console.info('Success: Default Resources Tagged');

          sendResponse(event, context, 'SUCCESS');
        }).catch(error => {
          responseData = {Error: 'Could not tag Default Resources'};
          console.error('Error: ' + responseData.Error + ':\n', error);

          sendResponse(event, context, 'FAILED', responseData);
        });

      }).catch(error => {
        responseData = {Error: 'Could not obtain Default Resource Ids or VPC Tags'};
        console.error('Error: ' + responseData.Error + ':\n', error);

        sendResponse(event, context, 'FAILED', responseData);
      });
      break;

    case 'Delete':
      sendResponse(event, context, 'SUCCESS');
      break;

    default:
      responseData = {Error: 'Unknown operation: ' + event.RequestType};
      console.error('Error: ' + responseData.Error);
      sendResponse(event, context, 'FAILED', responseData);
  }
};

function sendResponse(event, context, responseStatus, responseData, physicalResourceId, noEcho) {
  let responseBody = JSON.stringify({
    Status: responseStatus,
    Reason: 'See the details in CloudWatch Log Stream: ' + context.logStreamName,
    PhysicalResourceId: physicalResourceId || context.logStreamName,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    NoEcho: noEcho || false,
    Data: responseData
  });

  console.info('Response body:\n', responseBody);

  const https = require('https');
  const url = require('url');

  let parsedUrl = url.parse(event.ResponseURL);
  let options = {
    hostname: parsedUrl.hostname,
    port: 443,
    path: parsedUrl.path,
    method: 'PUT',
    headers: {
      'content-type': '',
      'content-length': responseBody.length
    }
  };

  let request = https.request(options, function(response) {
    console.info('Status code: ' + response.statusCode);
    console.info('Status message: ' + response.statusMessage);
    context.done();
  });

  request.on('error', function(error) {
    console.info('send(..) failed executing https.request(..): ' + error);
    context.done();
  });

  request.write(responseBody);
  request.end();
}
