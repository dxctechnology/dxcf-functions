/**
 ** Scheduler: A Lambda function that can start and stop Instances based on a defined Schedule
 **  to reduce costs.
 **
 ** This function is meant to be called via CloudWatch Schedule.
 **
 ** Schedule Tag formats initially supported:
 ** - "06:30-18:30"                     = (Every Day, Start+Stop, Use Region Timezone)
 ** - "06:30-"                          = (Every Day, Start only, Use Region Timezone)
 ** -      "-18:30"                     = (Every Day, Stop only, Use Region Timezone)
 ** - "18:30-06:30"                     = (Every Day, Start+Stop, Use Region Timezone, Stop before Start)
 ** - "06:30-18:30 Americas/New_York"   = (Every Day, Start+Stop, Use Specified Timezone)
 ** - "06:30- Americas/Los_Angeles"     = (Every Day, Start only, Use Specified Timezone)
 ** -      "-18:30 Europe/Dublin"       = (Every Day, Stop only, Use Specified Timezone)
 **
 ** Schedule Tag formats eventually we hope to support:
 ** - "Mo-Fr 06:30-18:30 Europe/Dublin" = (Mon-Fri, Start+Stop, Use Specified Timezone)
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

const changeTimezone = (date, timezone) => {
  const dateOffset = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
  const diff = date.getTime()-dateOffset.getTime();

  return new Date(date.getTime() + diff);
};

const getSpecificTime = (timeString, timezone) => {
  const timeRegExp = new RegExp(`^([01][0-9]|2[0-3]):[0-5][0-9]$`);

  if (timeRegExp.test(timeString)) {
    const now = new Date();
    let startTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), timeString.slice(0, 2), timeString.slice(3, 5));
    if (timezone) {
      startTime = changeTimezone(startTime, timezone);
    }

    return startTime;
  }
  else {
    throw new Error(`Time ${timeString} invalid`);
  }
};

const getScheduleTagRegExp = () => {
  // I hope you understand Regular Expressions! These have both capturing and non-capturing groups, needed in the match()
  // statement to both validate the Schedule Tag is in the proper format, where parts are optional, and to capture the
  // start and stop times along with the timezone when specified.
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

  const scheduleTagRegExp = getScheduleTagRegExp();

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
    const now = new Date();

    console.info(`Region Time: ${new Date(now).toLocaleTimeString("en-US", {hour12: false, timeZoneName:'long', timeZone: regionTimeZone})}`);

    for (const instance of instances) {
      const matches = instance.Schedule.match(scheduleTagRegExp);
      if (matches) {
        console.info(`Instance ${instance.InstanceId} is ${instance.State}, Schedule '${instance.Schedule}' is valid`);
        const startTimeString = matches[1];
        const stopTimeString = matches[2];
        const timeZone = (matches[3]) ? matches[3] : regionTimeZone;

        const startTime = (startTimeString) ? getSpecificTime(startTimeString, timeZone) : undefined;
        const stopTime = (stopTimeString) ? getSpecificTime(stopTimeString, timeZone) : undefined;

        console.info(`- Current time: ${new Date(now).toLocaleString("en-US", {hour12: false, timeZoneName:'long', timeZone: timeZone})}`);
        if (startTime) {
          console.info(`- Start   time: ${new Date(startTime).toLocaleString("en-US", {hour12: false, timeZoneName:'long', timeZone: timeZone})}`);
        }
        if (stopTime) {
          console.info(`- Stop    time: ${new Date(stopTime).toLocaleString("en-US", {hour12: false, timeZoneName:'long', timeZone: timeZone})}`);
        }

        if (startTime && instance.State != 'running' &&
           ((!stopTime && now > startTime)                                                 || // Schedule: "06:30-"
             (stopTime && startTime < stopTime && (now > startTime && now < stopTime))     || // Schedule: "06:30-18:30"
             (stopTime && startTime > stopTime && (now > startTime || now < stopTime)))) {    // Schedule: "18:30-06:30"
          console.info(`- Current state ${instance.State}, should be started...`);
          if (!test) {
            console.info(`- Starting Instance...`);
            const state = await startInstance(instance.InstanceId);
            console.info(`- Instance start requested, new state is ${state}`);
          }
          else {
            console.info(`NOT Starting Instance due to test mode`);
          }
        }

        if (stopTime && instance.State != 'stopped' &&
           ((!startTime && now > stopTime)                                                  || // Schedule:      "-18:30"
             (startTime && startTime < stopTime && (now > stopTime || now < startTime))     || // Schedule: "06:30-18:30"
             (startTime && startTime > stopTime && (now > stopTime && now < startTime)))) {    // Schedule: "18:30-06:30"                                                            // Schedule: "18:30-06:30"
          console.info(`- Current state ${instance.State}, should be stopped...`);
          if (!test) {
            console.info(`- Stopping Instance...`);
            const state = await stopInstance(instance.InstanceId);
            console.info(`Instance stop requested, new state is ${state}`);
          }
          else {
            console.info(`NOT Stopping Instance due to test mode`);
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
