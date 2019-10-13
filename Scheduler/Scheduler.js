/**
 ** Scheduler: A Lambda function that can start and stop Instances based on a defined Schedule
 **  to reduce costs.
 **
 ** This function is meant to be called via CloudWatch Schedule.
 **
 ** Schedule Tag formats initially supported:
 ** - "06:30-18:30"                     = (Every Day, Start+Stop, Use Region TimeZone)
 ** - "06:30-"                          = (Every Day, Start only, Use Region TimeZone)
 ** -      "-18:30"                     = (Every Day, Stop only, Use Region TimeZone)
 ** - "18:30-06:30"                     = (Every Day, Start+Stop, Use Region TimeZone, Stop before Start)
 ** - "06:30-18:30 Americas/New_York"   = (Every Day, Start+Stop, Use Specified TimeZone)
 ** - "06:30- Americas/Los_Angeles"     = (Every Day, Start only, Use Specified TimeZone)
 ** -      "-18:30 Europe/Dublin"       = (Every Day, Stop only, Use Specified TimeZone)
 **
 ** Schedule Tag formats eventually we hope to support:
 ** - "Mo-Fr 06:30-18:30 Europe/Dublin" = (Mon-Fri, Start+Stop, Use Specified TimeZone)
 ** - "Mo,We,Fr 06:30-18:30"            = (Mon,Wed,Fri, Start+Stop)
 ** - "Mo-Fr 06:30-18:30; Sa-Su -18:30  = (Mon-Fri, Start+Stop; Weekends, Stop only)
 **
 **/

const AWS = require('aws-sdk');
AWS.config.apiVersions = {
  ec2: '2016-11-15'
};

const ec2 = new AWS.EC2();

const parseBoolean = (value) => {
  const re=/^(t(rue)?|1|on|y(es)?)$/i;
  return re.test(value);
};

const validateEvent = (event, source, detailType) => {
  if (! event) {
    throw new Error(`event invalid`);
  }
  if (! event.source || event.source != source) {
    throw new Error(`event.source ${event.source} invalid, expecting ${source}`);
  }
  if (! event['detail-type'] || event['detail-type'] != detailType) {
    throw new Error(`event.detail-type ${event['detail-type']} invalid, expecting ${detailType}`);
  }
};

const getRegionTimeZone = (region) => {
  switch (region) {
    case 'us-east-1': // US East (N. Virginia)
      return 'America/New_York';
    case 'us-east-2': // US East (Ohio)
      return 'America/New_York';
    case 'us-west-1': // US West (N. California)
      return 'America/Los_Angeles';
    case 'us-west-2': // US West (Oregon)
      return 'America/Los_Angeles';
    case 'ap-east-1': // Asia Pacific (Hong Kong)
      return 'Asia/Hong_Kong';
    case 'ap-south-1': // Asia Pacific (Mumbai)
      return 'Asia/Kolkata';
    case 'ap-northeast-2': // Asia Pacific (Seoul)
      return 'Asia/Seoul';
    case 'ap-southeast-1': // Asia Pacific (Singapore)
      return 'Asia/Singapore';
    case 'ap-southeast-2': // Asia Pacific (Sydney)
      return 'Australia/Sydney';
    case 'ap-northeast-1': // Asia Pacific (Tokyo)
      return 'Asia/Tokyo';
    case 'ca-central-1': // Canada (Central)
      return 'America/Toronto';
    case 'eu-central-1': // EU (Frankfurt)
      return 'Europe/Berlin';
    case 'eu-west-1': // EU (Ireland)
      return 'Europe/Dublin';
    case 'eu-west-2': // EU (London)
      return 'Europe/London';
    case 'eu-west-3': // EU (Paris)
      return 'Europe/Paris';
    case 'eu-north-1': // EU (Stockholm)
      return 'Europe/Stockholm';
    case 'me-south-1': // Middle East (Bahrain)
      return 'Asia/Bahrain';
    case 'sa-east-1': // South America (Sao Paulo)
      return 'America/Sao_Paulo';
    default:
      throw new Error(`Region ${region} is unknown`);
  }
};

const currentTimeInTimeZone = (timeZone) => {
  return new Date().toLocaleTimeString("en-US", {hour12: false, timeZoneName:'long', timeZone: timeZone});
};

let getScheduleTagValidateRegExp = () => {
  // I hope you understand Regular Expressions! The Capture RegExp below was letting through some invalid patterns, and
  // I could not figure out a way to handle the 3 variants of 00:00-, -00:00 or 00:00-00:00 with an optional Time Zone
  // AND also do the caputure into consistent groups, so I decided to split up the logic into first validating the
  // entire time range was correct first via this RegExp, then using the second RegExp to break up a known valid Tag.
  const timeValidatePattern = '([01][0-9]|2[0-3]):[0-5][0-9]';
  const optionalTimeZoneValidatePattern = '( ([A-Z][_A-Za-z0-9]*\/[A-Z][_+A-Za-z0-9]*))?';

  return new RegExp(`^(${timeValidatePattern}-|-${timeValidatePattern}|${timeValidatePattern}-${timeValidatePattern})${optionalTimeZoneValidatePattern}$`);
};

let getScheduleTagCaptureRegExp = () => {
  // I hope you understand Regular Expressions! These have both capturing and non-capturing groups, needed in the match()
  // statement to both validate the Schedule Tag is in the proper format, where parts are optional, and to capture the
  // start and stop times along with the timeZone when specified.
  const optionalTimeCapturePattern = '((?:(?:[01][0-9]|2[0-3]):[0-5][0-9])?)';
  const optionalTimeZoneCapturePattern = '(?: ([A-Z][_A-Za-z0-9]*\/[A-Z][_+A-Za-z0-9]*))?';

  return new RegExp(`^${optionalTimeCapturePattern}-${optionalTimeCapturePattern}${optionalTimeZoneCapturePattern}`);
};

const getScheduledInstances = async (tag = 'Schedule') => {
  const params = {
    Filters: [{ Name: 'instance-state-name', Values: [ 'running', 'stopped' ]},
              { Name: 'tag-key', Values: [ tag ] }]
  };
  const data = await ec2.describeInstances(params).promise();
  //console.info(`- DescribeInstances Data:\n${JSON.stringify(data, null, 2)}`);

  // Extract and return only the values we want. The reduce step flattens 2 levels of array into 1 level.
  return data.Reservations.map(r => r.Instances.map(i => ({ InstanceId: i.InstanceId,
                                                            State: i.State.Name,
                                                            Schedule: i.Tags.filter(t => t.Key == tag)[0].Value })))
                          .reduce((a, b) => a.concat(b), []);
};

const startInstance = async (instanceId) => {
  const params = {
    InstanceIds: [ instanceId ]
  };
  const data = await ec2.startInstances(params).promise();
  //console.info(`- StartInstances Data:\n${JSON.stringify(data, null, 2)}`);

  return data.StartingInstances[0].CurrentState.Name;
};

const stopInstance = async (instanceId) => {
  const params = {
    InstanceIds: [ instanceId ]
  };
  const data = await ec2.stopInstances(params).promise();
  //console.info(`- StopInstances Data:\n${JSON.stringify(data, null, 2)}`);

  return data.StoppingInstances[0].CurrentState.Name;
};

exports.handler = async (event, context) => {
  console.info(`Event:\n${JSON.stringify(event)}`);

  const scheduleTagValidateRegExp = getScheduleTagValidateRegExp();
  const scheduleTagCaptureRegExp = getScheduleTagCaptureRegExp();

  const tag = process.env.TAG || 'Schedule';
  const test = parseBoolean(process.env.TEST);

  if (test) {
    console.info(`Test Mode: Record actions which would be taken in the log, but do not perform them.`);
  }

  validateEvent(event, 'aws.events', 'Scheduled Event');

  console.info(`Obtaining Instances subject to Scheduling...`);
  const instances = await getScheduledInstances(tag);

  if (instances.length > 0) {
    const region = context.invokedFunctionArn.split(':')[3];
    const regionTimeZone = getRegionTimeZone(region);
    const regionTime = currentTimeInTimeZone(regionTimeZone);

    console.info(`Region Time: ${regionTime}`);

    for (const instance of instances) {
      const matches = instance.Schedule.match(scheduleTagCaptureRegExp);
      if (scheduleTagValidateRegExp.test(instance.Schedule) && matches) {
        console.info(`Instance ${instance.InstanceId} is ${instance.State}, Schedule [${instance.Schedule}] is valid`);
        const startTime = matches[1];
        const stopTime = matches[2];
        const timeZone = (matches[3]) ? matches[3] : regionTimeZone;

        const currentFullTime = currentTimeInTimeZone(timeZone);
        const currentTime = currentFullTime.slice(0,5);
        const currentTimeZoneName = currentFullTime.slice(9);

        console.info(`- Current: ${currentTime}` + ((startTime) ? `, Start: ${startTime}` : '')
                                                 + ((stopTime) ? `, Stop: ${stopTime}` : '')
                                                 + ` (${currentTimeZoneName})`);

        if (startTime && instance.State != 'running' &&
           ((!stopTime && currentTime >= startTime)                                                         || // Schedule: "06:30-"
             (stopTime && startTime < stopTime && (currentTime >= startTime && currentTime < stopTime))     || // Schedule: "06:30-18:30"
             (stopTime && startTime > stopTime && (currentTime >= startTime || currentTime < stopTime)))) {    // Schedule: "18:30-06:30"
          console.info(`--- Currently ${instance.State}, should be started...`);
          if (!test) {
            console.info(`--- Starting Instance...`);
            const state = await startInstance(instance.InstanceId);
            console.info(`--- Start requested, now ${state}`);
          }
          else {
            console.info(`--- NOT Starting Instance due to test mode`);
          }
        }

        if (stopTime && instance.State != 'stopped' &&
           ((!startTime && currentTime >= stopTime)                                                          || // Schedule:      "-18:30"
             (startTime && startTime < stopTime && (currentTime >= stopTime || currentTime < startTime))     || // Schedule: "06:30-18:30"
             (startTime && startTime > stopTime && (currentTime >= stopTime && currentTime < startTime)))) {    // Schedule: "18:30-06:30"
          console.info(`--- Currently ${instance.State}, should be stopped...`);
          if (!test) {
            console.info(`--- Stopping Instance...`);
            const state = await stopInstance(instance.InstanceId);
            console.info(`--- Stop requested, now ${state}`);
          }
          else {
            console.info(`--- NOT Stopping Instance due to test mode`);
          }
        }
      }
      else {
        console.error(`Instance ${instance.InstanceId} is ${instance.State}, Schedule '${instance.Schedule}' is invalid (format) - ignoring!`);
      }
    }
  }
  else {
    console.info(`Instances subject to Scheduling not found`);
  }

  return context.logStreamName;
};
