/**
* DomainNameServers: A Lambda function that updates NameServers for a Route53 Domain
*
* This function is meant to be called direct from a CustomResource in the same Account,
* or indirect from the DomainNameServersProxy CustomResource Lambda Function in a different Account.
**/

const response = require('cfn-lambda-response-promise');

const AWS = require('aws-sdk');
AWS.config.update({region: 'us-east-1'}); // Global
AWS.config.apiVersions = {
  route53domains: '2014-05-15'
};

const route53domains = new AWS.Route53Domains();

const updateDomainNameservers = async (domainName, nameServers) => {
  const params = {
    DomainName: domainName,
    Nameservers: [{ Name: nameServers[0] },
                  { Name: nameServers[1] },
                  { Name: nameServers[2] },
                  { Name: nameServers[3] }]
  };
  await route53domains.updateDomainNameservers(params).promise();
};

exports.handler = async (event, context) => {
  console.info(`Request Body:\n${JSON.stringify(event)}`);

  switch (event.RequestType) {
    case 'Create':
    case 'Update':
      try {
        const domainName = event.ResourceProperties.DomainName;
        if (! domainName) {
          throw new Error(`DomainName missing!`);
        }

        const nameServers = event.ResourceProperties.NameServers;
        if (! nameServers) {
          throw new Error(`NameServers missing`);
        }

        console.info(`DomainName: ${domainName}`);
        console.info(`NameServers: ${nameServers}`);

        console.info(`Calling: updateDomainNameservers...`);
        await updateDomainNameservers(domainName, nameServers);

        const physicalResourceId = `${domainName}[${nameServers.toString()}]`;
        console.info(`Domain NameServers: ${physicalResourceId}`);
        await response.send(event, context, response.SUCCESS, {}, physicalResourceId);
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
