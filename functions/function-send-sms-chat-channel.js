const nodeFetch = require('node-fetch');
const { URLSearchParams } = require('url');
const uuidv1 = require('uuid/v1');
const Base64 = require('js-base64').Base64;

const verifyEventProps = (event) => {
  const result = {
    success: false
  };

  if (!event.fromName) {
    result.reason = `Missing 'fromName' in request body`;
  } else if (!event.fromNumber) {
    result.reason = `Missing 'fromNumber' in request body`;
  } else if (!event.toName) {
    result.reason = `Missing 'toName' in request body`;
  } else if (!event.toNumber) {
    result.reason = `Missing 'toNumber' in request body`;
  } else if (!event.message) {
    result.reason = `Missing 'message' in request body`;
  } else {
    result.success = true;
  }

  return result;
};

exports.handler = async function(context, event, callback) {
  console.log('Received event with properties:');
  Object.keys(event).forEach((key) => {
    console.log(`--${key}:`, event[key]);
  });

  console.log('Context:', context);

  const response = new Twilio.Response();
  response.appendHeader('Access-Control-Allow-Origin', '*');
  response.appendHeader('Access-Control-Allow-Methods', 'OPTIONS POST');
  response.appendHeader('Content-Type', 'application/json');
  response.appendHeader('Access-Control-Allow-Headers', 'Content-Type');

  const client = context.getTwilioClient();
  const { fromName, fromNumber, toName, toNumber, message } = event;

  const eventCheck = verifyEventProps(event);
  if (!eventCheck.success) {
    console.log('Event property check failed.', eventCheck.reason);
    return callback(JSON.stringify(eventCheck), null);
  }

  const flexFlowsApi = 'https://flex-api.twilio.com/v1/FlexFlows';
  
  let fetchResponse = await nodeFetch(flexFlowsApi, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${Base64.encode(`${context.ACCOUNT_SID}:${context.AUTH_TOKEN}`)}`
    },
  });
  let jsonResponse = await fetchResponse.json();
  console.log('Flex Flows response:', JSON.stringify(jsonResponse));
  const flexFlows = jsonResponse.flex_flows;
  let flexFlow;
  for (let i = 0; i < flexFlows.length; i++) {
    const flow = flexFlows[i];
    if (flow.contact_identity === fromNumber) {
      flexFlow = flow;
      break;
    }
  }
  
  const chatServicesSid = flexFlow.chat_service_sid;
  const flexFlowSid = flexFlow.sid;
  console.log('Matching flow chat service SID:', chatServicesSid);
  console.log('Matching flex flow sid:', flexFlowSid);

  const chatClient = client.chat.services(chatServicesSid);
  const flexChannelsApi = 'https://flex-api.twilio.com/v1/Channels';

  let urlParams = new URLSearchParams();
  urlParams.append('FlexFlowSid', flexFlowSid);
  urlParams.append('Target', toNumber);
  const identity = uuidv1();
  urlParams.append('Identity', identity);
  urlParams.append('ChatUserFriendlyName', toName);
  urlParams.append('ChatFriendlyName', `SMS${toNumber}`);

  fetchResponse = await nodeFetch(flexChannelsApi, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Base64.encode(`${context.ACCOUNT_SID}:${context.AUTH_TOKEN}`)}`
    },
    body: urlParams
  });
  jsonResponse = await fetchResponse.json();
  const chatChannelSid = jsonResponse.sid;
  const responseBody = { identity };
  for (let prop in jsonResponse) {
    responseBody[prop] = jsonResponse[prop];
  }
  console.log(`Chat channel created: ${chatChannelSid}`);

  let messageResponse = await client.messages.create({
    from: fromNumber,
    to: toNumber,
    body: message
  });
  console.log(`SMS message sent from ${fromNumber} to ${toNumber}. SID: ${messageResponse.sid}`);

  let chatMessageResponse = await chatClient
    .channels(chatChannelSid)
    .messages
    .create({
      from: fromName,
      body: message
    });
  console.log(`Chat message ${chatMessageResponse.sid} added to channel ${chatChannelSid}`);

  response.setBody({
    ...responseBody
  });

  callback(null, response);
}