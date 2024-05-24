import {spawn} from 'child_process';
import fs from 'fs';
import https from 'https';
import http from 'http';
import os from 'os';
import path from 'path';
import {URL} from 'url';
import {unescape} from 'querystring';

import {WebSocket} from 'ws';
import {SocksProxyAgent} from 'socks-proxy-agent';

import {
  debounce,
  OurWorld,
  StartupTabs,
  EXPEDITE,
  LOG_FILE,
  SignalNotices,
  NoticeFile,
  noticeFilePath,
  NOTICE_SIGNAL,
  APP_ROOT, FLASH_FORMATS, DEBUG, 
  CONFIG,
  sleep, SECURE_VIEW_SCRIPT, MAX_TABS, 
  consolelog,
  untilTrue,
  untilTrueOrTimeout,
} from '../common.js';

import {username} from '../args.js';
import {WorldName} from '../public/translateVoodooCRDP.js';
import {RACE_SAMPLE, makeCamera, COMMON_FORMAT, DEVICE_FEATURES, SCREEN_OPTS, MAX_ACK_BUFFER, MIN_WIDTH, MIN_HEIGHT} from './screenShots.js';
import {blockAds,onInterceptRequest as adBlockIntercept} from './adblocking/blockAds.js';
import {Document} from './api/document.js';
import {getInjectableAssetPath, LatestCSRFToken, fileChoosers} from '../ws-server.js';

//import {overrideNewtab,onInterceptRequest as newtabIntercept} from './newtab/overrideNewtab.js';
//import {blockSites,onInterceptRequest as whitelistIntercept} from './demoblocking/blockSites.js';

// standard injections
const selectDropdownEvents = fs.readFileSync(path.join(APP_ROOT, 'zombie-lord', 'injections', 'selectDropdownEvents.js')).toString();
const keysCanInputEvents = fs.readFileSync(path.join(APP_ROOT, 'zombie-lord', 'injections', 'keysCanInput.js')).toString();
const textComposition = fs.readFileSync(path.join(APP_ROOT, 'zombie-lord', 'injections', 'textComposition.js')).toString();
const fileInput = fs.readFileSync(path.join(APP_ROOT, 'zombie-lord', 'injections', 'fileInput.js')).toString();
const favicon = fs.readFileSync(path.join(APP_ROOT, 'zombie-lord', 'injections', 'favicon.js')).toString();
const elementInfo = fs.readFileSync(path.join(APP_ROOT, 'zombie-lord', 'injections', 'elementInfo.js')).toString();
const scrollNotify = fs.readFileSync(path.join(APP_ROOT, 'zombie-lord', 'injections', 'scrollNotify.js')).toString();
const botDetectionEvasions = fs.readFileSync(path.join(APP_ROOT, 'zombie-lord', 'injections', 'pageContext', 'botDetectionEvasions.js')).toString();
const showMousePosition = fs.readFileSync(path.join(APP_ROOT, 'zombie-lord', 'injections', 'pageContext', 'showMouse.js')).toString();

// plugins injections
const appMinifier = fs.readFileSync(path.join(APP_ROOT, 'plugins', 'appminifier', 'injections.js')).toString();
const projector = fs.readFileSync(path.join(APP_ROOT, 'plugins', 'projector', 'injections.js')).toString();

// API injection
const devAPIInjection = [
  'protocol.js',
].map(file => fs.readFileSync(path.join(APP_ROOT, 'zombie-lord', 'api', 'injections', file)).toString()).join('\n');

// Custom Injection
let customInjection = ''
if ( process.env.INJECT_SCRIPT ) {
  try {
    customInjection = fs.readFileSync(path.resolve(process.env.INJECT_SCRIPT)).toString();
  } catch(e) {
    console.warn(`Custom Injection could not be loaded: ${process.env.INJECT_SCRIPT}\nError: ${e}`, e);
  }
}

let customProxy = null;
if ( process.env?.TOR_PROXY?.startsWith?.('socks') ) {
  customProxy = new SocksProxyAgent(process.env.TOR_PROXY);
}

// just concatenate the scripts together and do one injection
// but for debugging better to add each separately
// we can put in an array, and loop over to add each
const injectionsScroll = `(function () {
  if( !self.zanjInstalled ) {
     {
       ${[fileInput, favicon, keysCanInputEvents, scrollNotify, elementInfo, textComposition, selectDropdownEvents].join('\n')}
     }
     ${CONFIG.devapi ? devAPIInjection : ''}
     self.zanjInstalled = true;
     // custom below this line
     ${customInjection ? customInjection : ''}
  } 
}())`;
const manualInjectionsScroll = `(function () {
  ${fileInput + favicon + keysCanInputEvents + scrollNotify + elementInfo + textComposition + selectDropdownEvents}
  ${DEBUG.showMousePosition ? showMousePosition : ''}
}())`;
const pageContextInjectionsScroll = `(function () {
  ${botDetectionEvasions}
  ${DEBUG.showMousePosition ? showMousePosition : ''}
}())`;

const templatedInjections = {
};

const docViewerSecret = process.env.DOCS_KEY;
const MAX_TRIES_TO_LOAD = 10;
const TAB_LOAD_WAIT = 300;
const RECONNECT_MS = 5000;
const WAIT_FOR_DOWNLOAD_BEGIN_DELAY = 5000;
const WAIT_FOR_COALESCED_NETWORK_EVENTS = 1000

import {
  deskUA_Mac_FF,
  deskUA_Mac_Chrome,
  mobUA_iOSFF,
  mobUA_iOSSafari,
  deskPlat_Mac,
  mobPlat_iOS,
  LANG,
  VEND_FF,
  ua,
} from './navigator.js';

const GrantedPermissions = [
  "geolocation", 
  "notifications", 
  "durableStorage", 
  /** the following are probably not secure 
    "clipboardReadWrite", 
    "clipboardSanitizedWrite", 
  **/
  /*"flash", (no longer works and results in no grant for anything */ 
  /** the following don't do anything in chrome headless
    "midi",
    "audioCapture", 
    "backgroundSync", 
    "backgroundFetch", 
    "displayCapture", 
    "midiSysex", 
    "nfc", 
    "paymentHandler", 
    "periodicBackgroundSync", 
    "protectedMediaIdentifier", 
    "sensors", 
    "videoCapture", 
    "videoCapturePanTiltZoom", 
    "idleDetection", 
  **/
];
//const PromptText = "Dosy was here.";
const ROOT_SESSION = 'root';

// for fun
const Area51Lat = 37.234332396;
const Area51Long = -115.80666344;

// throttling 'open in external app' requests
const INTENT_PROMPT_THRESHOLD = 30000;

const mobUA = mobUA_iOSSafari;
//const deskUA = deskUA_Mac_FF;
const deskUA = deskUA_Mac_Chrome;
const mobPlat = mobPlat_iOS;
const deskPlat = deskPlat_Mac;
const UA = deskUA;
const Plat = deskPlat_Mac;
const VEND = VEND_FF;

DEBUG.debugNavigator && console.log({UA, mobUA, deskUA, Plat, VEND});

const checkSetup = new Map();
const targets = new Set(); 
const waitingToReload = new Set();
//const waiting = new Map();
const sessions = new Map();
const viewports = new Map();
const viewChanges = new Map();
const casts = new Map();
const castStarting = new Map();
const loadings = new Map();
const tabs = new Map();
const favicons = new Map();
const Frames = new Map();
const MainFrames = new Map();
const PowerSources = new Map();
const OpenModals = new Map();
const SetupTabs = new Map();
const settingUp = new Map();
const FrameContexts = {};
const ContextIds = new Map();
//const originalMessage = new Map();
const DownloadPath = path.resolve(CONFIG.baseDir , 'browser-downloads');
let worldId = 1;
let GlobalFrameId = 1;
let AD_BLOCK_ON = true;
let DEMO_BLOCK_ON = false;
let firstSource;
let latestTimestamp;
let lastV = JSON.stringify(getViewport(),null,2); 
let lastVT = lastV+'startup';
let lastWChange = '';
let updatingTargets = false;

function addSession(targetId, sessionId) {
  sessions.set(targetId,sessionId);
  sessions.set(sessionId,targetId);
}

function startLoading(sessionId) {
  let loading = loadings.get(sessionId);  
  if ( ! loading ) {
    loading = {waiting:0, complete:0,targetId:sessions.get(sessionId)}
    loadings.set(sessionId,loading);
  }
  loading.waiting++;
  return loading;
}

function endLoading(sessionId) {
  let loading = loadings.get(sessionId);  
  //if ( ! loading ) throw new Error(`Expected loading for ${sessionId}`);
  if ( ! loading ) {
    console.warn(`Expected loading for ${sessionId}`);
    return;
  }
  loading.waiting--;
  loading.complete++;
  return loading;
}

function clearLoading(sessionId) {
  loadings.delete(sessionId);
}

function removeSession(id) {
  const otherId = sessions.get(id);
  sessions.delete(id);
  sessions.delete(otherId);
}

//let id = 0;

/**
  Note, to support multiple clients we cannot simply call Connect for each one
  to create multiple CRDP sessions into the one browser.

  The reason is because each session will have its own target and sessionId
  and some things we want to do for shared browsing require sharing that 
  information across clients.

  1 Connect call per client would require a translation table among targetIds and sessionIds
**/
export default async function Connect({port}, {adBlock:adBlock = DEBUG.adBlock, demoBlock: demoBlock = false} = {}) {
  const reloadAfterSetup = debounce(_reloadAfterSetup, 757);
  AD_BLOCK_ON = adBlock;

  LOG_FILE.Commands = new Set([
    ...(DEBUG.debugTyping ? [
      "Input.dispatchKeyEvent",
      "Input.insertText",
    ] : []),
    ...(DEBUG.debugFileUpload ? [
      'DOM.setFileInputFiles',
      'Page.fileChooserOpened',
      'Page.setInterceptFileChooserDialog',
    ] : []),
    ...(DEBUG.debugCast ? [
      "Emulation.setDeviceMetricsOverride",
      "Browser.setWindowBounds",
      "Page.startScreencast",
      "Page.stopScreencast",
      "Input.dispatchMouseEvent",
      "Input.emulateTouchFromMouseEvent",
      //"Page.captureScreenshot",
      "Runtime.evaluate",
      "Target.activateTarget",
      "Connection.activateTarget",
      "Page.screencastFrameAck",
      "Page.screencastFrame",
    ] : []),
    ...(DEBUG.debugViewports ? [
      "Emulation.setDeviceMetricsOverride",
      "Emulation.setUserAgentOverride",
      "Emulation.setScrollbarsHidden",
      "Browser.setWindowBounds",
      "Page.reload",
      "Page.startScreencast",
      "Page.stopScreencast",
    ] : []),
    ...(DEBUG.debugReloadLoop ? [
      "Page.reload",
    ] : []),
    ...(DEBUG.debugNewWorlds ? [
      "Runtime.executionContextCreated",
      "Runtime.executionContextDestroyed",
      "Runtime.executionContexsCleared",
      "Page.addScriptToEvaluateOnNewDocument",
      "Page.frameAttached",
      "Page.frameDetached",
    ] : []),
  ]);

  if ( demoBlock ) {
    AD_BLOCK_ON = false;
    DEMO_BLOCK_ON = true;
  }
  const connection = {
    zombie: await makeZombie({port}),
    // the clients ({peer, socket} objects)
    links: new Map,
    viewports,
    // send to client function
    so: null,
    port,
    browserTargetId: null,
    loadingCount: 0,
    totalBandwidth: 0,
    downloaded: {},
    record: {},
    frameBuffer: [],
    pausing: new Map(),
    worlds: new Map(),
    sessionSend,
    sessions,
    targets,
    tabs,
    favicons,
    sessionId: null,
    bounds: Object.assign({}, COMMON_FORMAT),
    navigator: { userAgent: UA, platform: Plat, acceptLanguage: LANG, vendor: VEND },
    plugins: {},
    setClientErrorSender(e) {
      this.zombie.sendErrorToClient = e;
    },
    // screencast related
    casts,
    latestCastId: null,
    activeTarget: null,
    lastCommonViewport: '{}',
    // modals related
    OpenModals,
    // helpers
    reloadAfterSetup,
  };

  process.on(NOTICE_SIGNAL, reportNoticeOnSignal);

  function reportNoticeOnSignal(signal) {
    try {
      const notice = fs.readFileSync(noticeFilePath).toString();
      DEBUG.debugNoticeSignal && console.log({signal, notice});
      const modal = {
        type: 'notice',
        title: "System Notice",
        message: notice,
      };
      connection.forceMeta({modal});
      const randomName = path.resolve(SignalNotices, 'old' + Math.random().toString(36) + performance.now());
      fs.renameSync(noticeFilePath, randomName);
      fs.unlinkSync(randomName);
    } catch(e) {
      console.log(`Error on sending notice`, e, {signal});
    }
  }

  if ( DEBUG.metaDebug ) {
    const arr = [];
    Object.defineProperty(connection, 'meta', {
      get: () => {
        //console.log(`Getting connection.meta`, arr.length, (new Error).stack);
        console.log('accessing meta', JSON.stringify(arr), (new Error).stack);
        return arr;
      },
      set: val => {
        console.log(`SETTING connection.meta`, arr.length, (new Error).stack);
        arr.push(...val); 
      }
    });
  } else {
    (DEBUG.debugFavicon || DEBUG.metaDebug) && console.warn(`META: resetting meta`, JSON.stringify(connection.meta));
    connection.meta = [];
  }
  connection.zombie.on('disconnect', async () => {
    console.log(`Reconnecting to zombie in ${RECONNECT_MS}`);
    process.off(NOTICE_SIGNAL, reportNoticeOnSignal);
    await sleep(RECONNECT_MS);
    setTimeout(async () => {
      // maybe should actually call makeZombie again?
      const next_connection = await Connect(
        {port:connection.port}, 
        {adBlock, demoBlock}
      );
      Object.assign(connection,next_connection);
    }, RECONNECT_MS);
  });

  {
    const {doShot, queueTailShot, shrinkImagery, growImagery, restartCast, stopCast, startCast} = makeCamera(connection);
    connection.doShot = doShot;
    connection.queueTailShot = queueTailShot;
    connection.shrinkImagery = shrinkImagery;
    connection.growImagery = growImagery;
    connection.restartCast = restartCast;
    connection.stopCast = stopCast;
    connection.startCast = startCast;
  }

  if ( DEBUG.useFlashEmu ) {
    try {
      templatedInjections.flashEmu = templatedInjections.flashEmu || 
        await import(path.join(APP_ROOT, 'zombie-lord', 'injections', 'templated', 'flashEmu.js'));
    } catch(e) {
      console.warn(`Error importing flashEmu.js`, e);
    }
  }
  if ( DEBUG.useDocCustomDownloadPlugin ) {
    try {
      templatedInjections.docDownloadPlugin = templatedInjections.docDownloadPlugin || 
        await import(path.join(APP_ROOT, 'zombie-lord', 'injections', 'templated', 'docDownloadPlugin.js'));
    } catch(e) {
      console.warn(`Error importing flashEmu.js`, e);
    }
  }

  console.log({port});
  const {send,on, ons} = connection.zombie;

  const document = new Document({send, on, ons});

  const {targetInfo:browserTargetInfo} = await send("Target.getTargetInfo", {});
  connection.browserTargetId = browserTargetInfo.targetId;

  ! DEBUG.legacyShots && await send("HeadlessExperimental.enable", {});
  await send("Target.setDiscoverTargets", {
    discover:true,
    filter: [
      {type: 'page'}
    ]
  });
  await send("Target.setAutoAttach", {
    autoAttach:DEBUG.attachImmediately, 
    waitForDebuggerOnStart:DEBUG.attachImmediately, 
    flatten:true, 
    filter: [
      {type: 'page'}
    ]
  });

  await send("Browser.setDownloadBehavior", {
    behavior: "allowAndName",
    downloadPath: DownloadPath,
    eventsEnabled: true
  });
  on("Browser.downloadWillBegin", beginDownload);
  on("Browser.downloadProgress", progressDownload);

  on("Target.targetCreated", async ({targetInfo}) => {
    DEBUG.val && consolelog('create 1', targetInfo);
    const {targetId} = targetInfo;
    targets.add(targetId);
    tabs.set(targetId,targetInfo);
    connection.forceMeta({created:targetInfo,targetInfo});
    if ( targetInfo.type == "page" && !DEBUG.attachImmediately ) {
      await send("Target.attachToTarget", {targetId, flatten:true});
    }
    DEBUG.val && consolelog('create 2', targetInfo);
  });

  on("Target.targetInfoChanged", async ({targetInfo}) => {
    DEBUG.val && consolelog('change 1', targetInfo);
    const {targetId} = targetInfo;
    if ( tabs.has(targetId) ) {
      tabs.set(targetId,targetInfo);
      connection.meta.push({changed:targetInfo,targetInfo});
      if ( targetInfo.type == "page" ) {
        connection.doShot();
      }
    } else {
      DEBUG.val > DEBUG.med && console.log("Changed event for removed target", targetId, targetInfo);
    }
    DEBUG.val && consolelog('change 2', targetInfo);
    if ( checkSetup.has(targetId) && targetInfo.url !== 'about:blank' ) {
      const sessionId = sessions.get(targetId);
      if ( sessionId ) {
        const obj = checkSetup.get(targetId);
        await sleep(TAB_LOAD_WAIT);
        const worlds = connection.worlds.get(sessionId);
        DEBUG.val && console.log('worlds at info changed', worlds);

        let missingWorlds = ! worlds;

        if ( worlds ) {
          const {frameTree} = await send("Page.getFrameTree", {}, sessionId);
          MainFrames.set(sessionId, frameTree.frame.id);
          const max = 0; // world.size /* max frames to enumerate, 0 is all */
          const frameList = enumerateFrames(frameTree, max);
          DEBUG.worldDebug && consolelog('Frames', frameList, 'worlds', worlds);
          missingWorlds = worlds.size < frameList.length;
        }

        if ( missingWorlds ) {
          DEBUG.worldDebug && consolelog(
            'Our tab has not fully loaded all our injections. Will reload', 
            targetInfo
          );
          const obj = checkSetup.get(targetId);
          if ( obj.val > 0 ) {
            obj.val--;
          } else {
            console.warn(`Tried ${MAX_TRIES_TO_LOAD} times to load our injections in tab, but didn't work. Not trying anymore.`, targetInfo);
            checkSetup.delete(targetId);
          }
          if ( obj.checking ) {
            DEBUG.worldDebug && consolelog(`Already checking ${targetId}`, obj);
            return;
          }
          obj.checking = true;
          if ( !obj.tabSetup ) {
            obj.needsReload = true;
          } else {
            reloadAfterSetup(sessionId);
          }
        } else {
          checkSetup.delete(targetId);
          DEBUG.worldDebug && consolelog(`Our tab is loaded!`, targetInfo);
        }
      }
    }
  });

  on("Target.attachedToTarget", async ({sessionId,targetInfo,waitingForDebugger}) => {
    DEBUG.worldDebug && consolelog('attached 1', targetInfo);
    DEBUG.val && consolelog('attached 1', targetInfo);
    const attached = {sessionId,targetInfo,waitingForDebugger};
    const {targetId} = targetInfo;
    DEBUG.val > DEBUG.med && console.log("Attached to target", sessionId, targetId);
    targets.add(targetId);
    addSession(targetId, sessionId);
    checkSetup.set(targetId, {val:MAX_TRIES_TO_LOAD, checking:false, needsReload: StartupTabs.has(targetId)});
    connection.meta.push({attached});
    // we always size when we attach, otherwise they just go to screen size
    // which might be bigger than the lowest common screen dimensions for the clients
    // so they will call a resize anyway, so we just anticipate here
    await setupTab({attached});
    /**
      // putting this here will stop open in new tab from working, since
      // we will reload a tab before it has navigated to its intended destination
      // in effect resetting it mid navigation, whereupon it remains on about:blank
      // and information about its intended destination is lost
      const worlds = connection.worlds.get(sessionId);
      DEBUG.val && console.log('worlds at attached', worlds);
      if ( ! worlds ) {
        await send("Page.reload", {}, sessionId);
      }
    **/
    DEBUG.val && consolelog('attached 2', targetInfo);
    DEBUG.worldDebug && consolelog('attached 2', targetInfo);
  });

  on("Target.detachedFromTarget", ({sessionId}) => {
    const detached = {sessionId};
    const targetId = sessions.get(sessionId);
    targets.delete(targetId);
    tabs.delete(targetId);
    removeSession(sessionId);
    if ( connection.activeTarget === targetId ) {
      connection.activeTarget = null;
    }
    deleteWorld(targetId);
    connection.meta.push({detached});
  });

  on("Target.targetCrashed", meta => endTarget(meta, 'crashed'));

  on("Target.targetDestroyed", meta => endTarget(meta, 'destroyed'));

  ons("Page.screencastFrame", sendFrameToClient);
  ons("Target.receivedMessageFromTarget", receiveMessage);
  //ons("LayerTree.layerPainted", receiveMessage);
  ons("Page.frameRequestedNavigation", receiveMessage);
  ons("Network.requestWillBeSent", receiveMessage);
  ons("Network.dataReceived", receiveMessage);
  ons("Network.loadingFailed", receiveMessage);
  ons("Network.responseReceived", receiveMessage);
  ons("Fetch.requestPaused", receiveMessage);
  ons("Fetch.authRequired", receiveMessage);
  ons("Runtime.bindingCalled", receiveMessage);
  ons("Runtime.consoleAPICalled", receiveMessage);
  ons("Runtime.executionContextCreated", receiveMessage);
  ons("Runtime.executionContextDestroyed", receiveMessage);
  ons("Runtime.executionContextsCleared", receiveMessage);
  ons("Page.frameNavigated", receiveMessage);
  ons("Page.fileChooserOpened", receiveMessage);
  ons("Page.javascriptDialogOpening", receiveMessage);
  ons("Runtime.exceptionThrown", receiveMessage);
  ons("Target.detachedFromTarget", receiveMessage);

  if ( DEBUG.coords ) {
    ons("Page.frameNavigated", async ({message, sessionId}) => {
      const dimensions = await send("Page.getLayoutMetrics", {}, sessionId);
      console.log({dimensions});
    });
  }

  await send(
    "Browser.grantPermissions", 
    {
      permissions: GrantedPermissions
    }
  );
  
  function sendFrameToClient({message, sessionId}) {
    if ( DEBUG.logFileCommands && LOG_FILE.Commands.has(message.method) ) {
      const {params: {data, metadata}, method, sessionId} = message;
      let stack = '';
      if ( DEBUG.noteCallStackInLog ) {
        stack = (new Error).stack; 
      }
      console.info(`Logging`, {method, params: {metadata, data:'img data...'}, sessionId, stack});
      setTimeout(() => {
        fs.appendFileSync(LOG_FILE.FileHandle, JSON.stringify({
          timestamp: (new Date).toISOString(),
          message,
        },null,2)+"\n");
      }, 5);
    }
    const {sessionId: castSessionId, data, metadata} = message.params;
    const {timestamp} = metadata;
    const {frameId} = updateCast(sessionId, {castSessionId}, 'frame');

    if ( !sessions.has(sessionId) ) return;

    if ( timestamp <= latestTimestamp ) {
      DEBUG.logCastOutOfOrderFrames && console.warn(
        `Frame ${frameId} is from earlier than a prior frame. Dropping frame`,
        {delta:(-latestTimestamp+timestamp)}
      );
      // ack it so we keep up the pace
      if ( ! sessionId ) {
        console.warn(`1 No sessionId for screencast ack`);
      }
      setTimeout(() => send("Page.screencastFrameAck", {sessionId: frameId}, sessionId), 5);
      return;
    }
    latestTimestamp = timestamp;

    const targetId = sessions.get(sessionId);
    const frame = Buffer.from(data, 'base64');
    const header = Buffer.alloc(28);
    //DEBUG.debugCast && console.log({writing:{castSessionId,frameId}});
    header.writeUInt32LE(castSessionId, 0);
    header.writeUInt32LE(frameId, 4);
    header.writeUInt32LE(parseInt(targetId.slice(0,8), 16), 8);
    header.writeUInt32LE(parseInt(targetId.slice(8,16), 16), 12);
    header.writeUInt32LE(parseInt(targetId.slice(16,24), 16), 16);
    header.writeUInt32LE(parseInt(targetId.slice(24,32), 16), 20);
    const imgBuf = Buffer.concat([header,frame]);
    for ( const {ack, fastest, peer, socket, connectionId} of connection.links.values() ) {
      /* here connectionId is a unique id for connection to browser-frontend client */
      const channel = fastest ? fastest : (socket || peer);
      if ( DEBUG.sendFramesWhenTheyArrive && ack.count ) {
        if ( ack.received || DEBUG.sendImmediate ) {
          connection.so(channel, imgBuf);
          ack.received = false;
          ack.count--;
          if ( ack.count < 0 ) ack.count = 0;
          DEBUG.adaptiveImagery && ack.sent.set(frameId, Date.now());
          if ( DEBUG.chooseFastest && DEBUG.useWebRTC && socket && peer ) {
            const choice = Math.random() >= RACE_SAMPLE;
            if ( choice ) {
              const otherChannel = channel === peer ? socket : peer;
              connection.so(otherChannel, imgBuf);
              DEBUG.logFastest && console.log('Race started');
            }
          }
        } 
      } else {
        ack.buffer.unshift([imgBuf, frameId]);
        if ( ack.buffer.length > MAX_ACK_BUFFER ) {
          ack.buffer.length = MAX_ACK_BUFFER;
        }
      }
    }
  }

  async function beginDownload(dl) {
    try {
      DEBUG.debugFileDownload && console.log({dl});
      const {suggestedFilename, guid, url: dlURL} = dl;
      const downloadFileName = suggestedFilename || getFileFromURL(dlURL);
      const download = {suggestedFilename, guid, url: dlURL};
      download.filename = downloadFileName;

      DEBUG.debugFileDownload && console.log({download});
      DEBUG.debugFileDownload && console.log({suggestedFilename});

      // notification
        connection.lastDownloadFileName = downloadFileName;

      // do only once
      if ( connection.lastDownloadGUID == download.guid ) return;
      connection.lastDownloadGUID = download.guid;

      // logging 
        DEBUG.debugFileDownload && console.log({downloadFileName,SECURE_VIEW_SCRIPT,username});

      const ext = downloadFileName.split('.').pop();
      const guidFile = path.resolve(DownloadPath, guid);
      const originalFile = path.resolve(DownloadPath, downloadFileName); 

      connection.forceMeta({download});

      DEBUG.debugFileDownload && console.log(`File ${downloadFileName} is downloading`);

      await untilTrue(() => !!connection.downloaded?.[guid], 1001, 3*3600); // wait 3 hours for a download

      DEBUG.debugFileDownload && console.log(`File ${downloadFileName} has downloaded`);

      DEBUG.debugFileDownload && console.info({guidFile,originalFile});
      await untilTrueOrTimeout(() => fs.existsSync(guidFile) || fs.existsSync(originalFile), 6); // wait 6 seconds for file to resolve
      
      // if the file is named with a guid copy it to original name
      if ( fs.existsSync(guidFile) ) {
        try {
          fs.linkSync(guidFile, originalFile);
          DEBUG.debugFileDownload && console.log(`GUID file name`, originalFile );
        } catch(e) {
          (DEBUG.debugFileDownload || DEBUG.showFlash) && console.info(`Could not create link from guid file`, e);
        } finally {
          try {
            fs.unlinkSync(guidFile);
          } catch {
            console.warn(`Could not delete guid file`, guidFile, downloadFileName);
          }
        }
      }
      if ( fs.existsSync(originalFile) ) {
        DEBUG.debugFileDownload && console.log(`Original file name`, originalFile );
      } else {
        console.warn(`Cannot find download`, download);
      }

      if ( FLASH_FORMATS.has(ext) ) {
        DEBUG.showFlash && console.log('Got a flash file', downloadFileName, download);
        const url = `${getInjectableAssetPath()}/flash-player.html?url=${
          encodeURIComponent(`${
            getInjectableAssetPath()
          }/flash/${
            downloadFileName
          }`)}&downloadFileName=${
            encodeURIComponent(downloadFileName)
        }&ran=${Math.random()}`;
        const flashplayer = {url};
        connection.forceMeta({flashplayer});
        DEBUG.showFlash && console.log("Send flash player", flashplayer);

        const linkToFile = path.resolve(APP_ROOT, 'public', 'assets', 'flash', downloadFileName);
        try {
          fs.linkSync(originalFile, linkToFile); 
        } catch(e) {
          DEBUG.showFlash && console.info(`Could not create link`, e);
        }
      } else {
        console.log({docViewerSecret, SECURE_VIEW_SCRIPT});
        const subshell = spawn(
          SECURE_VIEW_SCRIPT, 
          [username, `${originalFile}`, docViewerSecret]
        );
        let uri = '';
        let done = false;

        // subshell collect data and send once
          subshell.stderr.on('data', data => {
            console.warn('secure view script err:', data.toString());
          });
          subshell.stdout.on('data', data => {
            uri += data;
            console.log('secure view script data (uri):', uri);
          });
          subshell.on('error', x => {
            console.warn('secure view script error event:', x);
          });
          subshell.stdout.on('end', sendURL);
          subshell.on('close', sendURL);
          subshell.on('exit', sendURL);

        function sendURL(code) {
          const url = uri ? uri.trim() : "";

          if ( ! uri || url.length == 0 ) {
            console.warn("No URI", downloadFileName, uri, url);
            //throw new Error( "No URI" );
            return;
          }

          if ( code == 0 ) {
            // only do once
            if ( done ) return;
            done = true;
            connection.lastSentFileName = connection.lastDownloadFileName;

            // trim any whitespace added by the shell echo in the script
            const secureview = {url};
            DEBUG.debugfiledownload && console.log("Send secure view", secureview);
            connection.forceMeta({secureview});
          } else if ( code == undefined ) {
            console.log(`No code. Probably STDOUT end event.`, url);

            // only do once
            if ( done ) return;
            done = true;
            connection.lastSentFileName = connection.lastDownloadFileName;

            // trim any whitespace added by the shell echo in the script
            const secureview = {url};
            DEBUG.debugFileDownload && console.log("Send secure view", secureview);
            connection.forceMeta({secureview});
          } else {
            console.warn(`Secure View subshell exited with code ${code}`);
          }
        }
      }
    } catch(e) {
      console.warn(e);
    }
  }

  async function progressDownload({receivedBytes, totalBytes, guid, state, done}) {
    try {
      const amountToAddToServerData = Math.max(receivedBytes, totalBytes, 1);
      
      if ( Number.isInteger(amountToAddToServerData) ) {
        connection.totalBandwidth += amountToAddToServerData;
      }
      connection.forceMeta({downloPro:{receivedBytes, totalBytes, guid, state, done}});
      if ( done || state == 'completed' || (receivedBytes >= totalBytes && totalBytes > 0) ) {
        if ( ! connection.downloaded ) {
          connection.downloaded = {};
        }
        connection.downloaded[guid] = true;
      }
    } catch(e) {
      console.warn(e);
    }
  }

  async function receiveMessage({message, sessionId}) {
    await untilTrueOrTimeout(() => (typeof connection.forceMeta) == "function", 20);
    if ( message.method == "Network.dataReceived" ) {
      const {encodedDataLength, dataLength} = message.params;
      connection.totalBandwidth += (encodedDataLength || dataLength);
    } else if ( message.method == "Target.detachedFromTarget" ) {
      const {targetId} = message.params;
      removeSession(targetId);
      const sessionId = sessions.get(targetId);
      if ( connection.activeTarget === targetId ) {
        connection.activeTarget = null;
      }
      connection.meta.push({detached:message.params});
    } else if ( message.method == "Runtime.bindingCalled" ) {
      // normally we don't pass connection access through to controller (where this func is from)
      // but just for speed of implementation we do right now
      await executeBinding({message, sessionId, connection, send, on, ons});
    } else if ( message.method == "Runtime.consoleAPICalled" ) {
      const consoleMessage = message.params;
      const {type,args,executionContextId} = consoleMessage;

      const executionContextUniqueId = ContextIds.get(`${sessionId}-${executionContextId}`) || executionContextId;

      const logMessages = args.map(convertRemoteObjectToString);

      try {
        DEBUG.val && console.log("Runtime.consoleAPICalled",
          {executionContextUniqueId}, 
          {logMessageCount:logMessages.length}, 
          {type},
          JSON.stringify(logMessages).slice(0,255)
        );
      } catch(e) {
        console.warn("Could not show messages from console API");
        DEBUG.val && console.log(args);
      }

      if ( ! args.length ) return;

      const activeContexts = connection.worlds.get(connection.sessionId);
      DEBUG.val > DEBUG.low && console.log(`Active context`, activeContexts);
      // security note:
        // we should check this so people can spam us with messages
        // but there may be some things we need to send from page context. in that case
        // perhaps we ought to send them from 'binding' 
        /*if ( ! activeContexts || ! activeContexts.has(executionContextUniqueId) ) {
          DEBUG.val && console.log(`Blocking as is not a context in the active target.`);
          return;
        }*/

      message = consoleMessage;
      const firstArg = args[0];
      if ( DEBUG.debugConsoleMessages ) {
        const {type, args} = message;
        const argVals = args.map(({value, className, subtype, description}) => {
          if ( value === undefined ) {
            return `${description} ${subtype ? `(${subtype})` : ''}`;
          }
          return value;
        })
        console.group(`Remote console message (context: ${executionContextUniqueId})`);
        try {
          console[type](...argVals);
        } catch(e) {
          console.log(...argVals);
        }
        console.groupEnd();
      }
      if( firstArg.value ) {
        try {
          // we only accept JSON messages
          const Message = JSON.parse(firstArg.value);
          Message.executionContextUniqueId = executionContextUniqueId;
          if ( Message.favicon ) {
            const {faviconDataUrl, faviconURL, targetId} = Message.favicon;
            const oldUrl = favicons.get(targetId);
            if ( faviconDataUrl ) {
              if ( oldUrl !== faviconDataUrl ) {
                favicons.set(targetId, faviconDataUrl);
                connection.forceMeta(Message);
                DEBUG.debugFavicon && console.log(`FROM PAGE: Setting favicon for ${targetId}`, {Message});
              }
            } else if ( faviconURL?.startsWith?.('http') ) {
              if ( favicons.has(faviconURL) ) {
                const faviconDataUrl = favicons.get(faviconURL);
                if ( oldUrl !== faviconDataUrl ) {
                  favicons.set(targetId, faviconDataUrl);
                  const Message = {favicon:{targetId, faviconDataUrl}, executionContextUniqueId};
                  connection.forceMeta(Message);
                  DEBUG.debugFavicon && console.log(`FROM SERVER CACHE (from FETCH): Setting favicon for ${targetId}`, {Message});
                }
              } else {
                (DEBUG.val > DEBUG.high) && console.warn(
                  `Should probably be using CURL for this as we can easily replicate all headers
                  alternately we create a fetch request that replicates all headers from the browser.
                  We can save these headers from a network request. Tho this is complex. But it's the best way.`
                );
                DEBUG.debugFavicon && console.info(`Will send request for supposed favicon at url: ${faviconURL}`);
                if ( customProxy ) {
                  fetchWithTor(faviconURL, {
                    customProxy,
                    method: 'GET',
                    cache: 'force-cache',
                    headers: {
                      'user-agent': connection.navigator.userAgent
                    }
                  }).then(resp => {
                    if ( resp.ok ) {
                      const contentType = resp.headers['content-type'];
                      DEBUG.debugFavicon && console.log("resp", contentType, resp);
                      if ( contentType?.startsWith('image') ) {
                        try {
                          // do something
                        } catch(e) {
                          console.warn('favicon', e);
                        }
                      } else {
                        DEBUG.debugFavicon && console.warn(`Supposed favicon had incorrect content type: ${contentType}`);
                      }
                    }
                  });
                } else {
                  fetch(faviconURL, {
                    method: 'GET',
                    cache: 'force-cache',
                    headers: {
                      'user-agent': connection.navigator.userAgent
                    }
                  }).then(resp => {
                    if ( resp.ok ) {
                      const contentType = resp.headers.get('content-type');
                      DEBUG.debugFavicon && console.log("resp", contentType, resp);
                      if ( contentType?.startsWith('image') ) {
                        try {
                          resp.arrayBuffer().then(buf => {
                            const faviconDataUrl = `data:${contentType};base64,${
                              Buffer.from(buf).toString('base64')
                            }`;
                            favicons.set(faviconURL, faviconDataUrl);
                            if ( oldUrl !== faviconDataUrl ) {
                              favicons.set(targetId, faviconDataUrl);
                              const Message = {favicon:{targetId, faviconDataUrl}, executionContextUniqueId};
                              connection.forceMeta(Message);
                              DEBUG.debugFavicon && console.log(`FROM FETCH: Setting favicon for ${targetId}`, {Message});
                            }
                          });
                        } catch(e) {
                          console.warn('favicon', e);
                        }
                      } else {
                        DEBUG.debugFavicon && console.warn(`Supposed favicon had incorrect content type: ${contentType}`);
                      }
                    }
                  }).catch(err => {
                    DEBUG.showFaviconErrors && console.warn('favicon get err', Message, err);
                  });
                }
              }
            }
          } else {
            connection.forceMeta(Message);
          }
        } catch(e) {
          DEBUG.debugFavicon && firstArg.type === 'string' && firstArg.value.includes('favicon') &&
            console.log(`Error in favicon message`, e, message);
          DEBUG.val > DEBUG.med && console.log('console message err', e, message);
        }
      }
      DEBUG.val > DEBUG.med && connection.meta.push({consoleMessage});
    } else if ( message.method == "Runtime.executionContextCreated" ) {
      DEBUG.val && console.log(JSON.stringify({createdContext:message.params.context}));
      const {auxData, name:worldName, id:contextId, uniqueId} = message.params.context;
      ContextIds.set(`${sessionId}-${contextId}`, uniqueId);
      const cid = uniqueId || contextId;
      addContext(sessionId,cid);
      if ( worldName.startsWith(WorldName) ) {
        SetupTabs.set(sessionId, {worldName});
        if ( auxData.isDefault ) {
          OurWorld.set(sessionId, cid);
        }
        await send(
          "Runtime.addBinding", 
          {
            name: CONFIG.BINDING_NAME, 
            executionContextUniqueId: cid
          },
          sessionId
        );
      } else if ( DEBUG.manuallyInjectIntoEveryCreatedContext && !SetupTabs.get(sessionId)?.worldName?.startsWith?.(WorldName) ) {
        /*
        const targetId = sessions.get(sessionId);
        const expression = saveTargetIdAsGlobal(targetId) + manualInjectionsScroll;
        const resp = await send("Runtime.evaluate", {
          contextId,
          expression
        }, sessionId);
        DEBUG.val && console.log({resp,contextId});
        */
      }
      if ( auxData.frameId ) {
        const {frameId} = auxData;
        FrameContexts[frameId] = FrameContexts[frameId] || new Map();
        FrameContexts[frameId].set(cid, message.params.context);
        FrameContexts[cid] = frameId;
        //console.log(FrameContexts);
      }
    } else if ( message.method == "Runtime.executionContextDestroyed" ) {
      const contextId = message.params.executionContextUniqueId;
      const uniqueId = message.params.executionContextUniqueId;
      const cid = uniqueId || contextId;
      deleteContext(sessionId, cid);
      if ( FrameContexts[cid] ) {
        const frameId = FrameContexts[cid];
        FrameContexts[frameId].delete(cid);
        delete FrameContexts[cid];
        if ( FrameContexts[frameId].size == 0 ) {
          delete FrameContexts[frameId];
        }
        //console.log(FrameContexts);
      }
    } else if ( message.method == "Runtime.executionContextsCleared" ) {
      DEBUG.val > DEBUG.med && console.log("Execution contexts cleared");
      deleteWorld(sessionId);
    } else if ( message.method == "LayerTree.layerPainted" ) {
      if ( !DEBUG.screenCastOnly ) connection.doShot();
    } else if ( message.method == "Page.javascriptDialogOpening" ) {
      const {params:modal} = message;
      modal.sessionId = sessionId;
      (DEBUG.val || DEBUG.debugModals ) && console.log(JSON.stringify({modal}));
      connection.forceMeta({modal});
      connection.vmPaused = true;
      connection.modal = modal;
      connection.OpenModals.set(sessionId, modal);
    } else if ( message.method == "Page.frameNavigated" ) {
      const {url, securityOrigin, unreachableUrl, parentId} = message.params.frame;
      //const navigationType == message.params.type;
      const topFrame = !parentId;
      if ( !!topFrame && (!! url || !! unreachableUrl) ) {
        clearLoading(sessionId);
        const targetId = sessions.get(sessionId);
        if ( checkSetup.has(targetId) ) {
          // we could check this in a couple ms to see if we still have check setup and 
          // if so we might need another reload
          DEBUG.worldDebug && consolelog('Reloaded ?', targetId)
          const obj = checkSetup.get(targetId);
          DEBUG.worldDebug && consolelog(obj);
          obj.checking = false;
        }
        const navigated = {
          targetId,
          topFrame,
          url, unreachableUrl
        };

        favicons.delete(targetId);
        DEBUG.debugFavicon && console.log(`Deleted favicon for targetId ${targetId} upon navigation`);

        connection.forceMeta({favicon: {useDefaultFavicon: true}});
        connection.meta.push({navigated});
        // this is strangely necessary to not avoid the situation where the layer tree is not updated
        // on page navigation, meaning that layerPainted events stop firing after a couple of navigations
        /*
        await send(
          "LayerTree.enable", 
          {},
          sessionId
        );
        */
        //connection.doShot();
      }
      /**
        // we now do this once for browser, rather than the same thing for every origin
        if ( ! unreachableUrl && securityOrigin || url ) {
          const origin = securityOrigin || new URL(url).origin;
          console.log('granting', GrantedPermissions, origin);
          const resp = await send(
            "Browser.grantPermissions", 
            {
              permissions: GrantedPermissions
            }
          );
          DEBUG.val && console.log('grantPermissions resp', {resp});
          await send(
            "Emulation.setGeolocationOverride",
            {
              latitude: Area51Lat, longitude: Area51Long, accuracy: 5
            },
            sessionId
          );
        }
      **/
    } else if ( message.method == "Page.fileChooserOpened" ) {
      const {mode,backendNodeId} = message.params;
      const fileChooser = {mode, sessionId};

      DEBUG.val && console.log('file chooser', message);

      fileChoosers.set(sessionId, backendNodeId);
      DEBUG.debugFileUpload && console.log(`File chooser set`, fileChoosers, {sessionId, backendNodeId});

      DEBUG.val > DEBUG.med && console.log(fileChooser, message);

      try {
        const {node:{attributes:fileInputAttributes}} = await send("DOM.describeNode", {
          backendNodeId
        }, sessionId);

        if ( fileInputAttributes ) {
          for( let i = 0; i < fileInputAttributes.length; i++ ) {
            if ( fileInputAttributes[i] == "accept" ) {
              fileChooser.accept = fileInputAttributes[i+1];
              break;
            }
          }
        }
      } catch(e) {
        console.info(`Error getting FileInput.accept attribute by describing backend node from id`, e, fileChooser)
      }

      fileChooser.csrfToken = LatestCSRFToken;

      DEBUG.val && console.log('notify client', fileChooser);
      connection.forceMeta({fileChooser});
    } else if ( message.method == "Network.requestWillBeSent" ) {
      DEBUG.networkDebug && console.log({message});
      const resource = startLoading(sessionId);
      const {requestId,frameId, request:{url}} = message.params;
      if ( requestId && frameId ) {
        Frames.set(requestId,{url,frameId});
      }
      connection.meta.push({resource}); 
    } else if ( message.method == "Network.requestServedFromCache" ) {
      DEBUG.networkDebug && console.log({message});
      const resource = endLoading(sessionId);
      const {requestId} = message.params;
      connection.meta.push({resource}); 
      setTimeout(() => Frames.delete(requestId), WAIT_FOR_COALESCED_NETWORK_EVENTS);
    } else if ( message.method == "Network.loadingFinished" ) {
      const resource = endLoading(sessionId);
      const {requestId} = message.params;
      DEBUG.networkDebug && console.log({message});
      connection.meta.push({resource}); 
      setTimeout(() => Frames.delete(requestId), WAIT_FOR_COALESCED_NETWORK_EVENTS);
    } else if ( message.method == "Network.loadingFailed" ) {
      const resource = endLoading(sessionId);
      const {requestId} = message.params;
      const savedFrame = Frames.get(requestId)
      DEBUG.networkDebug && console.log({message, savedFrame});
      DEBUG.fontDebug && message.params.type == 'Font' && console.log({message, savedFrame});
      if ( savedFrame ) {
        const {url: url = '',frameId} = savedFrame;

        if ( message.params.type == "Document" ) {
          const someFileName = getFileFromURL(url);

          message.frameId = frameId;
          DEBUG.val && console.log({failedURL:url});
          if ( !(url.startsWith('http')) ) {
            const modal = {
              type: 'intentPrompt',
              title: 'External App Request',
              message: `This page is asking to open an external app via URL: ${
                url.slice(0, 140) + (url.length > 140 ? '...' : '')
              }`,
              url
            };
            DEBUG.val && console.log(JSON.stringify({modal},null,2));
            const now = Date.now();
            const delta = now - (connection.lastIntentPromptAt || 0);
            if ( DEBUG.throttleIntentPrompts && delta < INTENT_PROMPT_THRESHOLD ) {
              console.log(`Dropping intent prompt because it is more frequent than ${
                INTENT_PROMPT_THRESHOLD
              }ms`);
            } else {
              connection.lastIntentPromptAt = now;
              connection.forceMeta({modal});
            }
          } else {
            setTimeout(() => {
              if ( someFileName == connection.lastDownloadFileName ) {
                // this is not a failure 
                DEBUG.val && console.log({expectDownload:someFileName});
              } else {
                connection.meta.push({failed:message});
                DEBUG.val && console.log({failed:message});
              }
            }, WAIT_FOR_DOWNLOAD_BEGIN_DELAY );
          }
        }

        connection.meta.push({resource}); 
        setTimeout(() => Frames.delete(requestId), WAIT_FOR_COALESCED_NETWORK_EVENTS);
      } else {
        DEBUG.val && console.warn(`No url or frameId saved for requestId: ${requestId}`);
      }
    } else if ( message.method == "Network.responseReceived" ) {
      DEBUG.networkDebug && console.log({message});
      const resource = endLoading(sessionId);
      connection.meta.push({resource}); 
    } else if ( message.method == "Runtime.exceptionThrown" ) {
      (DEBUG.val || DEBUG.debugConsoleMessages) && console.log(JSON.stringify({exception:message.params}, null,2));
    } else if ( message.method == "Fetch.requestPaused" ) {
      DEBUG.fontDebug && message.params.resourceType == 'Font' && console.log({paused:message});
      //newtabIntercept({sessionId, message}, Target);
      if ( AD_BLOCK_ON ) { 
        await adBlockIntercept({sessionId, message}, connection.zombie);
      }
    } else if ( message.method == "Fetch.authRequired" ) {
      const {requestId, request, /*frameId, */ resourceType, authChallenge} = message.params;
      connection.pausing.set(requestId, request.url);
      connection.pausing.set(request.url, requestId);
      const authRequired = {authChallenge, requestId, resourceType};
      (DEBUG.debugAuth || DEBUG.val) && console.log({authRequired});
      connection.forceMeta({authRequired});
    } else if ( message.method && ( message.method.startsWith("LayerTree") || message.method.startsWith("Page") || message.method.startsWith("Network")) ) {
      // ignore
    } else { 
      console.warn("Unknown message from target", message);
    }
  }

  return connection;

  async function setupTab({attached}) {
    const {waitingForDebugger, sessionId, targetInfo} = attached;
    const {targetId} = targetInfo;
    if ( settingUp.has(targetId) ) return;
    settingUp.set(targetId, attached);
    DEBUG.attachImmediately && DEBUG.worldDebug && console.log({waitingForDebugger, targetInfo});

    try {
      DEBUG.val && console.log(sessionId, targetId, 'setting up');

      ! DEBUG.legacyShots && await send("HeadlessExperimental.enable", {}, sessionId);

      if ( ! loadings.has(sessionId) ) {
        const loading = {waiting:0, complete:0,targetId}
        loadings.set(sessionId,loading);
      }

      await send(
        "Emulation.setGeolocationOverride",
        {
          latitude: Area51Lat, longitude: Area51Long, accuracy: 5
        },
        sessionId
      );
      await send("Network.enable", {}, sessionId);
      if ( DEBUG.networkBlocking ) {
        await send("Network.setBlockedURLs", {
            urls: [
              ...(DEBUG.blockFileURLs ? ["file://*"] : []),
              ...(DEBUG.blockChromeURLs ? ["chrome:*"] : []),
            ]
          },
          sessionId
        );
      }
      await send(
        "Emulation.setUserAgentOverride", 
        connection.navigator,
        sessionId
      );
      await send(
        "Security.setIgnoreCertificateErrors",
        {
          ignore: DEBUG.ignoreCertificateErrors
        },
        sessionId
      );
      if ( AD_BLOCK_ON ) {
        await send("Fetch.enable",{
            handleAuthRequests: true,
            patterns: [
              {
                urlPattern: 'http://*/*',
                requestStage: "Response"
              },
              {
                urlPattern: 'https://*/*',
                requestStage: "Response"
              },
              {
                urlPattern: 'http://*/*',
                requestStage: "Request"
              },
              {
                urlPattern: 'https://*/*',
                requestStage: "Request"
              }
            ],
          },
          sessionId
        );
      }
      await send(
        "Emulation.setAutoDarkModeOverride",
        {
          enabled: CONFIG.darkMode
        },
        sessionId
      );
      await send(
        "Emulation.setEmulatedMedia",
        {
          media: 'screen',
          features: [
            {
              name: 'prefers-color-scheme',
              value: CONFIG.darkMode ? 'dark' : 'light'
            }
          ]
        },
        sessionId
      );
      if ( CONFIG.setAlternateBackgroundColor ) {
        await send(
          "Emulation.setDefaultBackgroundColorOverride",
          {
            color: { r: 120, g: 120, b: 120, a: 0.8 }
          },
          sessionId
        );
      }

      await send("Page.enable", {}, sessionId);

      if ( CONFIG.createPowerSource ) {
        const {frameTree: { frame : { id: frameId } }} = await send("Page.getFrameTree", {}, sessionId);
        MainFrames.set(sessionId, frameId);
        const {executionContextId} = await send("Page.createIsolatedWorld", {
          frameId: MainFrames.get(sessionId),
          worldName: 'POWER Source',
          grantUniveralAccess: true
        }, sessionId);
        console.log(`Created power source. Got context id: ${executionContextId} for sessionId: ${sessionId}`);
        PowerSources.set(sessionId, executionContextId);
      }

      if ( CONFIG.screencastOnly ) {
        let castInfo;
        if ( castStarting.get(targetId) ) {
          await untilTrue(() => casts.get(targetId)?.started, 200, 500);
          castInfo = casts.get(targetId);
        } else {
          castInfo = casts.get(targetId);
        }
        if ( !castInfo || ! castInfo.castSessionId ) {
          castStarting.set(targetId, true);
          updateCast(sessionId, {started:true}, 'start');
          DEBUG.shotDebug && console.log("SCREENCAST", SCREEN_OPTS);
          const {
            format,
            quality, everyNthFrame,
            maxWidth, maxHeight
          } = SCREEN_OPTS;
          await send("Page.startScreencast", {
            format, quality, everyNthFrame, 
            ...(DEBUG.noCastMaxDims ? 
              {}
              : 
              {maxWidth, maxHeight}
            ),
          }, sessionId);
          castStarting.delete(targetId);
        } else {
          if ( ! sessionId ) {
            console.warn(`2 No sessionId for screencast ack`);
          }
          await send("Page.screencastFrameAck", {
            sessionId: castInfo.castSessionId
          }, sessionId);
        }
      }

      if ( DEBUG.useFlashEmu ) {
        await send("Page.setBypassCSP", {enabled: true}, sessionId);
      }

      DEBUG.val && console.log('Enabling file chooser interception for session', sessionId);

      await send("Page.setInterceptFileChooserDialog", {
        enabled: true
      }, sessionId);
      await send(
        "DOMSnapshot.enable", 
        {},
        sessionId
      );
      await send(
        "Runtime.enable", 
        {},
        sessionId
      );
      // Page context injection (to set values in the page's original JS execution context
        let templatedInjectionsScroll = '';
        // Flash emulation injection
        if ( DEBUG.useFlashEmu ) {
          const injectableAssetPath = getInjectableAssetPath();
          const flashEmuScript = templatedInjections.flashEmu.default({
            injectableAssetPath
          });
          templatedInjectionsScroll += flashEmuScript;
        }
        if ( DEBUG.useDocCustomDownloadPlugin ) {
          const embeddingHostname = getEmbeddingHostname();
          const pluginScript = templatedInjections.docDownloadPlugin.default({
            embeddingHostname
          });
          templatedInjectionsScroll += pluginScript;
        }
        await send(
          "Page.addScriptToEvaluateOnNewDocument",
          {
            // NOTE: NO world name to use the Page context
            source: `console.log("i am page"); ` + pageContextInjectionsScroll + templatedInjectionsScroll,
            runImmediately: CONFIG.runInjectionsImmediately,
          },
          sessionId
        );
      // Isolated world injection
        let modeInjectionScroll = '';
        if ( connection.plugins.appminifier ) {
          modeInjectionScroll += appMinifier;
        } 
        if ( connection.plugins.projector ) {
          modeInjectionScroll += projector;
        }
        await send(
          "Page.addScriptToEvaluateOnNewDocument", 
          {
            source: [
              `console.log("I am isolated world")`,
              saveTargetIdAsGlobal(targetId),
              injectionsScroll,
              modeInjectionScroll
            ].join(';'),
            worldName: `${WorldName}${worldId++}`,
            runImmediately: CONFIG.runInjectionsImmediately,
          },
          sessionId
        );
      await send(
        "Emulation.setDeviceMetricsOverride", 
        connection.bounds,
        sessionId
      );
      /* 
        // notes
          // putting here causes tab startup stability issues, better to wait to apply it later
          // but if we're waiting then may as well just wait until we actually open devtools
          // this means we just send from client
        if ( DEBUG.fixDevToolsInactive && DEBUG.useActiveFocusEmulation ) {
          // don't await it as it's very experimental
          send(
            "Emulation.setFocusEmulationEnabled",
            {
              enabled: true, 
            },
            sessionId
          );
        }
      */
      await send(
        "Emulation.setScrollbarsHidden",
        {hidden:connection.isMobile || false},
        sessionId
      );
      const {windowId} = await send("Browser.getWindowForTarget", {targetId});
      connection.latestWindowId = windowId;
      let {width,height} = connection.bounds;
      if ( DEBUG.useNewAsgardHeadless ) {
        height += 80;
      }
      await send("Browser.setWindowBounds", {bounds:{width,height},windowId})
      //id = await overrideNewtab(connection.zombie, sessionId, id);
      if ( AD_BLOCK_ON ) {
        await blockAds(/*connection.zombie, sessionId*/);
      } else if ( DEMO_BLOCK_ON ) {
        console.warn("Demo block disabled.");
        //await blockSites(connection.zombie, sessionId);
      }
      if ( CONFIG.useLayerTreeDomain ) {
        await send(
          "LayerTree.enable", 
          {},
          sessionId
        );
      }
      if ( waitingForDebugger ) {
        await send("Runtime.runIfWaitingForDebugger", {}, sessionId);
      }
      const obj = checkSetup.get(targetId)
      if ( obj ) {
        if ( obj.needsReload ) {
          DEBUG.worldDebug && consolelog('Reloading', targetId);
          obj.needsReload = false; 
          reloadAfterSetup(sessionId);
          obj.checking = false;
        } 
        if ( CONFIG.inspectMode ) {
          setTimeout(async () => {
            await send("Overlay.enable", {}, sessionId);
            await send("Overlay.setInspectMode", {
              mode: 'searchForNode',
              highlightConfig: {
                showInfo: true,
                showAccessibilityInfo: false,
                borderColor: { r:0, g:255, b:22 },
                paddingColor: { r:0, g:255, b:22 },
                paddingColor: { r:0, g:255, b:22 },
                eventTargetColor: { r:0, g:255, b:22 },
              }
            }, sessionId);
          }, 300);
        }

        obj.tabSetup = true;
      } else {
        console.warn(`No checsetup entry at end of setuptab`, targetId);
      }
    } catch(e) {
      console.warn("Error setting up", e, targetId, sessionId);
    }
    settingUp.delete(targetId);
  }

  function updateCast(sessionId, castUpdate, event) {
    const targetId = sessions.get(sessionId);
    let castInfo = casts.get(targetId);

    if ( event === 'start' ) {
      DEBUG.debugCast && console.log(`Screencast info udpate on event: ${event} -- `, targetId, sessionId, castInfo);
    } else if ( event === 'frame' ) {
      /*
      DEBUG.debugCast && connection.latestCastId !== castUpdate.castSessionId && console.info(`
        We are changing the connection.latestCastId from ${
          connection.latestCastId
        } to ${
          castUpdate.castSessionId
      }`);
      */
      connection.latestCastId = castUpdate.castSessionId;
    } else if ( event === 'stop' ) {
      connection.latestCastId = null;
    }
    if ( ! castInfo ) {
      GlobalFrameId++;
      castInfo = {};
      Object.defineProperty(castInfo, 'frameId', {
        get: () => GlobalFrameId
      });
      casts.set(targetId, castInfo);
      DEBUG.debugCast && console.info(`Creating castInfo for target: ${targetId}`);
    } else {
      if ( event !== 'start' && 
          castInfo.castSessionId && castUpdate.castSessionId !== castInfo.castSessionId
        ) {
          DEBUG.debugCast && console.info(`Screencast info on event: ${event} -- ${
              castInfo.started ? '[normal ~ cast running]' : '[not normal ~ no cast running]'
            }: we are updating the cast session id for target ${targetId}, from ${
              castInfo.castSessionId 
            } to ${
              castUpdate.castSessionId
          }`);
      }
      if ( castUpdate.castSessionId ) {
        let {sessions} = castInfo;
        if ( ! sessions ) {
          sessions = castInfo.sessions = new Set();
        }
        sessions.add(castUpdate.castSessionId);
      }
      if ( castUpdate.started === false ) {
        let {sessions} = castInfo;
        if ( ! sessions || ! sessions.has(castUpdate.castSessionId) ) {
          DEBUG.debugCast && console.warn(`Screencast info on event: ${
            event
          } -- [not normal]: we are stopping a cast session (${
            castUpdate.castSessionId
          }) but we have no record of this session having started.`);
          if ( ! sessions ) {
            sessions = castInfo.sessions = new Set();
          }
        }
        sessions.delete(castInfo.castSessionId); 
        DEBUG.debugCast && console.info(`We are deleting the latest castSessionId ${
            castInfo.castSessionId
          } from our cast sessions set. We HOPE and assume it is the ONLY cast running for targetId ${
            targetId
        }`);
      }
    }
    Object.assign(castInfo, castUpdate);
    if ( castInfo.started === false ) {
      //castInfo.castSessionId = null;
    }
    if ( event === 'frame' ) {
      GlobalFrameId++;
    } else if ( event === 'stop' ) {
      DEBUG.debugCast && console.log(`Screencast info udpate on event: ${event} -- `, targetId, castInfo);
    } else if ( event === 'start' && ! castInfo.started ) {
      GlobalFrameId++;
    }
    return castInfo;
  }

  async function _reloadAfterSetup(sessionId) {
    if ( waitingToReload.has(sessionId) ) return;
    waitingToReload.add(sessionId);
    const targetId = sessions.get(sessionId);
    if ( settingUp.has(targetId) ) {
      await untilTrueOrTimeout(() => !settingUp.has(targetId), 15);
    }
    await sleep(100);
    await send("Page.reload", {ignoreCache:true}, sessionId);
    await sleep(100);
    waitingToReload.delete(sessionId)
  }

  async function sessionSend(command) {
    /* here connection is a connection to a browser backend */
    const that = this || connection;
    let sessionId;
    let isActivate = false;
    const {connectionId} = command;
    command.connectionId = null;
    let {targetId} = command.params;
    if ( !! targetId && !targets.has(targetId) ) {
      DEBUG.val && console.log("Blocking as target does not exist.", targetId);
      return {};
    }
    switch( command.name ) {
      case "Page.navigate": {
        let {url} = command.params;

        url = url.trim();

        if ( url.startsWith("file:") || isFileURL(url) ) {
          console.log("Blocking file navigation");
          return {};
        } else if ( url.startsWith("vbscript:") ) {
          console.log("Blocking vbscript protocol url");
          return {};
        } else if ( url.startsWith("javascript:") ) {
          console.log("Blocking javascript protocol url");
          return {};
        } else if ( url.startsWith("data:text/html") ) {
          console.log("Blocking HTML data URL");
          return {};
        }
      }; break;
      case "Browser.getWindowForTarget": {
        if ( !command.params.targetId ) {
          command.params.targetId = connection.hiddenTargetId;
        }
      }; break;
      case "Browser.setWindowBounds": {
        /* if the client has not requested we resize to their viewport
         we only move a bound if it's smaller than existing
         This ensures that the default behaviour is to let the remote
         browser viewport fit in everyone's screen
         This can be escaped by resetRequested
        */

        if ( command.params.windowId ) {
          connection.latestWindowId = command.params.windowId;
        }
        const viewport = getViewport(...connection.viewports.values());

        DEBUG.debugViewportDimensions && console.log('Command', command);
        DEBUG.debugViewportDimensions && console.log('Viewports', connection.viewports);
        DEBUG.debugViewportDimensions && console.log('Common viewport', viewport);

        if ( ! command.params.resetRequested ) {
          let {width, height} = viewport;
          if ( DEBUG.useNewAsgardHeadless ) {
            height += 80;
          }
          Object.assign(command.params.bounds, {width, height});
          Object.assign(connection.bounds, viewport);
        } else {
          // don't send our custom flag through to the browser
          if ( DEBUG.useNewAsgardHeadless ) {
            command.params.bounds.height += 80;
          }
          ensureMinBounds(command.params.bounds);
          Object.assign(connection.bounds, command.params.bounds);
        }
        delete command.params.bounds.resetRequested;
        if ( command.params.bounds.mobile ) {
          connection.isMobile = true;
          delete command.params.bounds.mobile;
        }
        DEBUG.debugViewportDimensions && console.log(connection.bounds);
        SCREEN_OPTS.maxWidth = connection.bounds.width;
        SCREEN_OPTS.maxHeight = connection.bounds.height;
        DEBUG.debugViewportDimensions && console.log("Screen opts at set window bounds", SCREEN_OPTS);
        DEBUG.debugViewportDimensions && console.log('Connection bounds', connection.bounds);
      }; break;
      case "Emulation.setDeviceMetricsOverride": {
        // there's a race where we call this before any targets so the "mobile changed blip does not take effect"
        // but if we have no targets we should not execute this code
        if ( sessions.size == 0 || targets.size == 0 ) {
          return {}; 
        }
        /* if the client has not request we resize to their viewport
         we only move a bound if it's smaller than existing
         This ensures that the default behaviour is to let the remote
         browser viewport fit in everyone's screen
         This can be escaped by resetRequested
        */

        const viewport = getViewport(...connection.viewports.values());
        DEBUG.debugViewportDimensions && console.log('Command', command);
        DEBUG.debugViewportDimensions && console.log('Viewports', connection.viewports);
        DEBUG.debugViewportDimensions && console.log('Common viewport', viewport);
        if ( viewport.mobile ) {
          connection.isMobile = true;
        }
        DEBUG.debugViewportDimensions && console.log('Common viewport', viewport);
        if ( ! command.params.resetRequested ) {
          Object.assign(command.params, viewport);
          Object.assign(connection.bounds, viewport);
        } else {
          // don't send our custom flag through to the browser
          ensureMinBounds(command.params);
          Object.assign(connection.bounds, command.params);
        }
        if ( ! command.params.deviceScaleFactor ) {
          command.params.deviceScaleFactor = 1;
        }
        DEBUG.debugViewportDimensions && console.log(connection.bounds);
        SCREEN_OPTS.maxWidth = connection.bounds.width;
        SCREEN_OPTS.maxHeight = connection.bounds.height;
        if ( command.params.deviceScaleFactor ) {
          DEVICE_FEATURES.deviceScaleFactor = command.params.deviceScaleFactor;
        } 
        if ( command.params.screenOrientation ) {
          DEVICE_FEATURES.screenOrientation = command.params.screenOrientation;
        }
        if ( command.params.mobile ) {
          DEVICE_FEATURES.mobile = command.params.mobile;
        } 
        DEBUG.debugViewportDimensions && console.log("Screen opts at device metric override", SCREEN_OPTS);
        DEBUG.debugViewportDimensions && console.log('Connection bounds', connection.bounds);
      }; break;
      case "Emulation.setScrollbarsHidden": {
        DEBUG.debugScrollbars && console.log("setting scrollbars 'hideBars'", command.params.hidden);
        connection.hideBars = command.params.hidden;
      }; break;
      case "Emulation.setUserAgentOverride": {
        let changed = false;
        //connection.navigator.platform = command.params.platform;
        //connection.navigator.userAgent = command.params.userAgent;
        //command.params.userAgent = connection.navigator.userAgent;
        //command.params.platform = connection.navigator.platform;

        changed = connection.navigator.userAgent !== command.params.userAgent;

        command.params.userAgent = connection.isMobile ? mobUA : deskUA;
        command.params.platform = connection.isMobile ? mobPlat : deskPlat;

        connection.navigator.platform = command.params.platform;

        connection.navigator.userAgent = command.params.userAgent;
        connection.navigator.acceptLanguage = command.params.acceptLanguage;

        if ( changed ) {
          //command.needsReload = true;
        }
      }; break;
      case "Target.createTarget": {
        if ( (sessions.size/2 + 1) > MAX_TABS ) {
          DEBUG.val && console.warn(`Blocking as TabCount > MAX_TABS`); 
          return {error: `Too many tabs`};
        } 
        if ( command.params.source ) {
          if ( !DEBUG.worldDebug && command.params.source === firstSource && 
              !DEBUG.enableClientsToSetURL ) {
            console.log("Blocking as only first sourced navigation is intended.");
            return {};
          } else if ( ! firstSource ) {
            firstSource = command.params.source;
          }
          delete command.params.source;
        }
        DEBUG.val && console.log(`Create. Tabs: ${sessions.size/2}`);
      }; break;
      case "Target.closeTarget": {
        targets.delete(targetId);
        tabs.delete(targetId);
        const tSessionId = sessions.get(targetId);
        if ( sessions.get(that.sessionId) == targetId ) {
          that.sessionId = null;
          that.currentCast = null;
        }
        if ( that.activeTarget === targetId ) {
          that.activeTarget = null;
        }
        removeSession(targetId);
        DEBUG.val && console.log(`Close. Tabs: ${sessions.size/2}`);
        if ( tSessionId ) {
          DEBUG.val > DEBUG.med && console.log("Received close. Will send detach first.");
          // FIX NOTE: these sleeps (have not test ms sensitivity, maybe we could go lower), FIX issue #130
          // in other words, they prevent the seg fault crash on Target.closeTarget we get sometimes
          await sleep(300);
          await send("Target.detachFromTarget", {sessionId:tSessionId});
          await sleep(300);
        }
      }; break;
      case "Fetch.continueWithAuth": {
        const {requestId} = command.params;
        const url = connection.pausing.get(requestId);
        DEBUG.debugAuth && console.log({auth:{url,command}})
        connection.pausing.delete(requestId);
        connection.pausing.delete(url);
      }; break;
      case "Page.handleJavaScriptDialog": {
        const modal = connection.OpenModals.get(command.params.sessionId);
        if ( ! modal ) {
          console.warn(`No modal for sessionId ${command.params.sessionId}`);
        } 
        connection.OpenModals.delete(command.params.sessionId);
        if ( connection.OpenModals.size == 0 ) {
          connection.vmPaused = false;
          DEBUG.debugModals && console.log({command});
          command.requiresTask = () => {
            connection.modal = null;
            connection.forceMeta({vm:{paused:false}});
          };
        }
      }; break;
      case "Target.activateTarget": {
        if ( CONFIG.screencastOnly && CONFIG.castSyncsWithActive ) {
          await connection.stopCast();
        }
        isActivate = true;
        that.sessionId = sessions.get(targetId); 
        that.targetId = targetId; 
        sessionId = that.sessionId;

        if ( ! that.sessionId ) { 
          console.error(`!! No sessionId at Target.activateTarget`);
        } else if ( DEBUG.showTargetSessionMap ) {
          console.log({targetId, sessionId});
        }

        const worlds = connection.worlds.get(sessionId);
        DEBUG.showWorlds && console.log('worlds at session send', worlds);

        if ( ! worlds ) {
          DEBUG.val && console.log("reloading because no worlds we can access yet");
          reloadAfterSetup(sessionId);
        } else {
          DEBUG.val && console.log("Tab is loaded",sessionId);
        }
        connection.activeTarget = targetId;

        if ( CONFIG.screencastOnly ) {
          let castInfo;
          if ( castStarting.get(targetId) ) {
            await untilTrue(() => casts.get(targetId)?.started, 200, 500);
            castInfo = casts.get(targetId);
          } else {
            castInfo = casts.get(targetId);
          }
           
          if ( !castInfo || ! castInfo.castSessionId || CONFIG.castSyncsWithActive ) {
            updateCast(sessionId, {started:true}, 'start');
            const {
              format,
              quality, everyNthFrame,
              maxWidth, maxHeight
            } = SCREEN_OPTS;
            await send("Page.startScreencast", {
              format, quality, everyNthFrame, 
              ...(DEBUG.noCastMaxDims ? 
                {}
                : 
                {maxWidth, maxHeight}
              ),
            }, sessionId);
            castInfo = casts.get(targetId);
            castStarting.delete(targetId);
          } else {
            if ( ! sessionId ) {
              console.error(`3 No sessionId for screencast ack`);
            }
            that.currentCast = castInfo;
          }

          if ( worlds ) {
            const [uniqueContextId] = [...worlds];
            send("Runtime.evaluate", {
              expression: `document.querySelector('my-cursor').style.borderRadius = 0;`,
              includeCommandLineAPI: false,
              userGesture: true,
              uniqueContextId,
              timeout: CONFIG.SHORT_TIMEOUT
            }, sessionId);
            send("Page.screencastFrameAck", {
              sessionId: castInfo.castSessionId
            }, sessionId);
            await sleep(200);
            send("Runtime.evaluate", {
              expression: `document.querySelector('my-cursor').style.borderRadius = '20px';`,
              includeCommandLineAPI: false,
              userGesture: true,
              uniqueContextId,
              timeout: CONFIG.SHORT_TIMEOUT
            }, sessionId);
          }
          // ALWAYS send an ack on activate
          await sleep(50);
          send("Page.screencastFrameAck", {
            sessionId: castInfo.castSessionId
          }, sessionId);
        }
        if ( DEBUG.dontSendActivate ) {
          return {};
        }
      }
    }

    if ( !command.name.startsWith("Target") && !(command.name.startsWith("Browser") && command.name != "Browser.getWindowForTarget") ) {
      sessionId = command.params.sessionId || that.sessionId;
    } 
    if ( command.name.startsWith("Target") || ! sessionId ) {
      if ( command.name.startsWith("Page") || command.name.startsWith("Runtime") || command.name.startsWith("Emulation") ) {
        sessionId = that.sessionId;
        DEBUG.coords && command.name.startsWith("Emulation") && console.log('Emulation session send 1', command, {sessionId})
        if ( sessionId ) {
          return await send(command.name, command.params, sessionId); 
        } else {
          //DEBUG.val && console.log(`Blocking as ${command.name} must be run with session.`, command);
          DEBUG.showNoSessionIdWarnings && console.warn(`!! No sessionId for command: ${JSON.stringify(command,null,2)}`);
          return {};
        }
      } else {
        DEBUG.val > DEBUG.med && console.log({zombieNoSessionCommand:command});
        const resp = await send(command.name, command.params); 

        if ( isActivate && CONFIG.doAckBlast ) {
          let castInfo = casts.get(targetId);
          castInfo.sessionHasReceivedFrame = false;
          let ac = 0;

          DEBUG.debugAckBlast && console.log(`Starting ack blast on activate`);

          untilTrue(async () => {
            if ( ! castInfo.sessionHasReceivedFrame ) {
              ac++;
              await send("Page.screencastFrameAck", {
                sessionId: castInfo?.castSessionId || 1
              }, sessionId);
              DEBUG.debugAckBlast && console.log(`Sent ack #${ac} for targetId ${targetId}`);
            } else {
              DEBUG.debugAckBlast && console.log(`Stopping ack blast after ${ac} acks because we have frame`);
            }
            DEBUG.debugAckBlast && console.log({castInfo});
            return castInfo.sessionHasReceivedFrame;
          }, 300, 2); // or until 20 seconds
        }

        return resp;
      }
    } else {
      if ( command.name !== "Page.screencastFrameAck" ) {
        sessionId = command.params.sessionId || that.sessionId;
        if ( ! sessionId || ! sessions.has(sessionId) ) {
          DEBUG.val && console.log("Blocking as session not exist.", sessionId);
          console.warn(`5 No sessionId at Page.screencastFrameAck`);
          return {};
        }
      } else {
        sessionId = command.sessionId || that.sessionId;
        //console.log(command, sessionId);
      }
      if ( !! command.params.uniqueContextId && ! hasContext(sessionId, command.params.uniqueContextId) ) {
        DEBUG.val && console.log("Blocking as context does not exist.", command, sessionId, connection.worlds, connection.worlds.get(sessionId) );
        return {};
      }
      DEBUG.val > DEBUG.med && 
        command.name !== "Page.captureScreenshot" && 
        command.name !== "HeadlessExperimental.beginFrame" &&
        console.log({zombieSessionCommand:command});
      try {
        const {requiresTask,needsReload} = command;
        command.needsReload = undefined;
        command.requiresTask = undefined;
        //DEBUG.coords && command.name.startsWith("Emulation") && console.log('Emulation session send 2', command, {sessionId})
        const r = await send(command.name, command.params, sessionId);
        if ( needsReload ) {
          reloadAfterSetup(sessionId);
        }
        if ( requiresTask ) {
          //setTimeout(() => {
            try {
              requiresTask();
            } catch(e) {
              console.warn(`Command`, command, `requiresTask`, requiresTask, `failed`, e);
            }
          //}, 0);
        }
        return r;
      } catch(e) {
        console.log(e);
        try {
          if ( e.Error && e.Error.indexOf("session") ) {
            const {sessionId} = e.request.params;
            removeSession(sessionId);
            if ( that.activeTarget === targetId ) {
              that.activeTarget = null;
            }
            DEBUG.val > DEBUG.med && console.log("Removed session");
          }
        } finally {
          void 0;
        }
      }
    }
  }

  function getEmbeddingHostname() {
    return `This is unknown at the time this code runs.`;
  }

  function addContext(id, contextId) {
    DEBUG.val > DEBUG.med && console.log({addingContext:{id,contextId}});
    const otherId = sessions.get(id);
    let contexts = connection.worlds.get(id);
    if ( ! contexts ) {
      contexts = new Set();
      connection.worlds.set(id, contexts);
      connection.worlds.set(otherId, contexts);
    }
    contexts.add(contextId);
  }

  function hasContext(sessionId, contextId) {
    const id = sessionId || connection.sessionId;
    const contexts = connection.worlds.get(id);
    if ( ! contexts ) return false;
    else return contexts.has(contextId);
  }

  function deleteContext(id, contextId) {
    DEBUG.val > DEBUG.med && console.log({deletingContext:{id,contextId}});
    //const otherId = sessions.get(id);
    let contexts = connection.worlds.get(id);
    if ( contexts ) {
      contexts.delete(contextId);
    }
  }

  function deleteWorld(id) {
    const otherId = sessions.get(id);
    connection.worlds.delete(id);
    connection.worlds.delete(otherId);
  }

  function endTarget({targetId}, label) {
    DEBUG.val > DEBUG.med && console.warn({[label]:{targetId}});
    const sessionId = sessions.get(targetId);
    if ( connection.activeTarget === targetId ) {
      connection.activeTarget = null;
    }
    viewChanges.delete(sessionId);
    loadings.delete(sessionId);
    targets.delete(targetId);
    tabs.delete(targetId);
    removeSession(targetId);
    deleteWorld(targetId);
    connection.meta.push({[label]:{targetId}});
  }
}

export function getViewport(...viewports) {
  if ( viewports.length === 0 ) {
    const {
      width, height, deviceScaleFactor,
    } = COMMON_FORMAT;
    return {width, height, deviceScaleFactor, mobile: false};
  }
  const vals = [...viewports.values()];
  const W = [...vals.map(v => v.width)];
  const H = [...vals.map(v => v.height)];
  const width = Math.min(...W);
  const height = Math.min(...H);
  let scale = 1.0;
  if ( CONFIG.useScaledUpCoViewport ) {
    const maxWidth = Math.max(...W);
    const maxHeight = Math.max(...H);
    if ( CONFIG.useCappedScaling && vals.findIndex(({mobile}) => mobile) ) {
      scale = Math.min(
        Math.min(CONFIG.mobileMaxWidth, maxWidth) / width,
        Math.min(CONFIG.mobileMaxHeight, maxHeight) / height
      );
    } else {
      scale = Math.min(maxWidth/width,maxHeight/height);
    }
  }
  const atLeastOneMobile = vals.some(({mobile}) => mobile);
  const deviceScaleFactor = Math.max(...viewports.map(v => v.deviceScaleFactor || scale || 1.0));
  const commonViewport = {
    width: Math.floor(width*scale), 
    height: Math.floor(height*scale),
    deviceScaleFactor,
    mobile: atLeastOneMobile
  };
  ensureMinBounds(commonViewport);
  if ( DEBUG.debugScaledUpCoViewport && CONFIG.useScaledUpCoViewport ) {
    console.log(vals);
    console.log({commonViewport});
  }
  return commonViewport;
}

export async function updateTargetsOnCommonChanged({connection, command, force = false}) {
  if ( updatingTargets ) {
    await untilTrueOrTimeout(() => !updatingTargets, 15);
  }
  updatingTargets = true;
  const {send,on, ons} = connection.zombie;
  const commonViewport = getViewport(...connection.viewports.values());
  DEBUG.debugViewportDimensions && console.log('Common viewport', commonViewport, (new Error).stack);
  connection.commonViewport = commonViewport;
  Object.assign(connection.bounds, connection.commonViewport);
  const cvs = JSON.stringify(commonViewport, null, 2);
  let proceed = false;
  if ( cvs != connection.lastCommonViewport || force ) {
    DEBUG.showOtherCommandsForViewportUpdate && console.info(`updateTargetsOnCommonChange called with command: ${command?.name}`, command);
    if ( command?.name == "Browser.setWindowBounds" || command == "all" ) {
        setTimeout(() => connection.restartCast(), 0);
    }
    if ( command?.name == "Emulation.setDeviceMetricsOverride" || command == "all" ) {
      DEBUG.showTodos && console.log(`Make V Changes sessionId linked (issue #351)`);
      const thisV = cvs;
      const thisT = (command?.params?.sessionId||command?.sessionId||connection.sessionId);
      const thisVT = thisV+thisT;
      //DEBUG.showUARedux && console.log({thisV,lastV,thisT,thisVT,lastVT,params:command?.params||commonViewport});
      const tabOrViewportChanged = lastVT != thisVT;
      const viewportChanged = lastV != thisV || (viewChanges.has(thisT) ? viewChanges.get(thisT) != thisV : false);
      const mobileChanged = JSON.parse(connection.lastCommonViewport)?.mobile != commonViewport.mobile;
      DEBUG.showViewportChanges && console.log(`lastVT: ${lastVT}`);
      DEBUG.showViewportChanges && console.log(`thisVT: ${thisVT}`);
      (DEBUG.showViewportChanges || DEBUG.debugViewportDimensions) && console.log({tabOrViewportChanged, viewportChanged});

      DEBUG.debugViewportDimensions && console.log({commonViewport});
      DEBUG.debugViewportDimensions && console.log('Viewports match?', connection.lastCommonViewport == cvs, {commonViewport}, {last:JSON.parse(connection.lastCommonViewport)});
      if ( mobileChanged ) {
        DEBUG.debugViewportChanges && console.warn(`Mobile changed`, commonViewport, connection.viewports);
      }
      await updateAllTargetsToUserAgent({mobile: commonViewport.mobile, connection})
      await updateAllTargetsToViewport({commonViewport, connection}); 

      if ( command?.params?.resetRequested ) {
        proceed = true;
        if ( command?.params ) {
          delete command.params.resetRequested;
        }
        lastV = thisV;
        viewChanges.set(thisT, thisV);
      }

      if ( true || tabOrViewportChanged  ) {
        lastVT = thisVT;
        setTimeout(async () => { 
          await connection.restartCast();
          if ( viewportChanged ) {
            DEBUG.showResizeEvents && console.log(`Sending resize event as viewport changed`, {lastV, thisV});
            connection.forceMeta({
              resize: connection.bounds
            });
          }
        }, 0);
      }
    } 
    
    if ( ! proceed && DEBUG.showSkippedCommandsAfterViewportChangeCheck ) {
      console.info(`Skipping command ${command?.name} in updateTargetsOnCommonChange, with commandViewport and command`, {commonViewport, command});
    }
    connection.lastCommonViewport = cvs;
  }
  updatingTargets = false;

  return proceed;
}

async function updateAllTargetsToUserAgent({mobile, connection}) {
  const {send,on, ons} = connection.zombie;
  let list = [];
  for ( const targetId of connection.targets.values() ) {
    const sessionId = sessions.get(targetId);
    try {
      const {result:{value:{userAgent}}} = await send("Runtime.evaluate", {
        expression: `
          (function () {
            return {userAgent: navigator.userAgent};
          }())
        `,
        returnByValue: true 
      }, sessionId);
      const desiredUserAgent = mobile ? mobUA : deskUA;
      DEBUG.debugUserAgent && console.log({mobile,targetId,userAgent,desiredUserAgent});
      if ( userAgent != desiredUserAgent ) {
        DEBUG.debugUserAgent && console.log(`Will update user agent for target ${targetId}`, {mobile,desiredUserAgent});
        const nav = {
          userAgent: desiredUserAgent,
          platform: mobile ? mobPlat : deskPlat,
          acceptLanguage: connection.navigator.acceptLanguage || 'en-US',
        };
        Object.assign(connection.navigator, nav);
        await send("Emulation.setUserAgentOverride", nav, sessionId);
        await send(
          "Emulation.setScrollbarsHidden",
          {hidden:mobile},
          sessionId
        );
      } else {
        DEBUG.debugUserAgent && console.log(`Will NOT update user agent for target ${targetId}`, {mobile,userAgent, desiredUserAgent});
      }
      list.push(sessionId);
    } catch(err) {
      console.warn(`Error updating user agent for double checked target`, {targetId, sessionId}, err);
    }
  }
  list = [...(new Set([...list]))];
  for ( const sessionId of list ) {
    connection.reloadAfterSetup(sessionId);
  }
}

async function updateAllTargetsToViewport({commonViewport, connection, skipSelf = false}) {
  const {send,on, ons} = connection.zombie;
  const windows = new Set();
  SCREEN_OPTS.maxWidth = commonViewport.width;
  SCREEN_OPTS.maxHeight = commonViewport.height;
  for ( const targetId of connection.targets.values() ) {
    const sessionId = sessions.get(targetId);
    //if ( sessionId == connection.sessionId && skipSelf ) continue; // because we will send it in the command that triggered this check
    let width, height, screenWidth, screenHeight;
    try {
      const {windowId} = await send("Browser.getWindowForTarget", {targetId});
      if ( !windows.has(windowId) ) {
        windows.add(windowId);
        let {width,height} = commonViewport;
        DEBUG.debugViewportDImensions && console.log({width,height,windowId});
        if ( DEBUG.useNewAsgardHeadless ) {
          height += 80;
        }
        await send("Browser.setWindowBounds", {bounds:{width,height}, windowId})
      }

      ({result:{value:{width,height,screenWidth,screenHeight}}} = await send("Runtime.evaluate", {
        expression: `
          (function () {
            return {width: window.innerWidth, height: window.innerHeight, screenWidth: screen?.width, screenHeight: screen?.height};
          }())
        `,
        returnByValue: true 
      }, sessionId));
      DEBUG.debugViewportDimensions && console.log('Actual page dimensions', {width,height});
      send("Emulation.setDeviceMetricsOverride", commonViewport, sessionId);
    } catch(err) {
      console.warn(`Error updating viewport to reflect change, during all targets update loop`, {targetId, sessionId}, err);
    }
  }
}

export async function executeBinding({message, sessionId, connection, send, on, ons}) {
  const {name, executionContextId} = message.params;
  let {payload} = message.params;
  try {
    payload = JSON.parse(payload);
  } catch(e) {console.warn(e)}

  let response;
  let key;
  if ( !!payload.method && !! payload.params ) { // interpret as Chrome Remote Debugging Protocol message
    payload.name = payload.method;
    payload.params.sessionId = payload.sessionId || sessionId;
    if ( ! payload.key ) {
      DEBUG.debugBinding && console.warn(`Intended bb.ctl protocol message has no key so response will not get reply.`);
    } else {
      ({key} = payload);
      delete payload.key;
    }
    if ( payload?.name?.startsWith?.("Connection.") ) {
      payload.isZombieLordCommand = true;
    }
    response = await connection.sessionSend(payload);
    response.key = key;
  }
  const expression = `self.${CONFIG.BINDING_NAME}._recv(${JSON.stringify({response})})`;
  DEBUG.debugBinding && console.log(JSON.stringify({bindingCalled:{name,payload,response,executionContextId,expression}}));
  await send(
    "Runtime.evaluate", 
    {
      expression,
      uniqueContextId: executionContextId, 
      awaitPromise: true
    },
    sessionId
  );
}

function ensureMinBounds(bounds) {
  if ( ! Number.isFinite(bounds.width) || bounds.width < MIN_WIDTH ) {
    bounds.width = MIN_WIDTH;
  }
  if ( ! Number.isFinite(bounds.height) || bounds.height < MIN_HEIGHT ) {
    bounds.height = MIN_HEIGHT;
  }
  return bounds;
}

function saveTargetIdAsGlobal(targetId) {
  return `
    {
      const targetId = "${targetId}";
      try {
        Object.defineProperty(self, 'targetId', {
          get: () => targetId,
        });
      } catch(e) {
        console.warn('Already defined targetId?', e);
      }
    }
  `;
}

function isFileURL(url) {
  const firstColonIndex = url.indexOf(':');

  const scheme = url.slice(firstColonIndex-4, firstColonIndex);

  return scheme == 'file';
}

async function makeZombie({port:port = 9222} = {}) {
  try {
    const {webSocketDebuggerUrl} = await fetch(`http://${
        DEBUG.useLoopbackIP ? '127.0.0.1' : 'localhost'
      }:${port}/json/version`).then(r => r.json());
    const socket = new WebSocket(webSocketDebuggerUrl);
    const Zombie = {
      disconnected: true
    };
    const Resolvers = {};
    const Handlers = {};
    const LAST_COMMANDS_WINDOW = 5;
    const lastCommands = [];
    socket.on('message', handle);
    socket.on('close', () => {
      Zombie.disconnected = true;
    });
    let id = 0;

    let resolve;
    const promise = new Promise(res => resolve = res);

    socket.on('open', () => {
      Zombie.disconnected = false;
      resolve();
    });

    await promise;

    Object.assign(Zombie, {
      send,
      on, ons
    });

    return Zombie;
    
    /* send debugging protocol message to browser */
    async function send(method, params = {}, sessionId) {
      if ( Zombie.disconnected ) {
        Zombie.sendErrorToClient('Our connection to chrome is disconnected. Probably means chrome shut down or crashed.');
        return;
      }
      const message = {
        method, params, sessionId, 
        id: ++id
      };
      const key = `${sessionId||ROOT_SESSION}:${message.id}`;
      let resolve;
      let promise = new Promise(res => resolve = res);
      if ( DEBUG.debugHistory && method.includes("History") ) {
        console.log(`History message`, message);
        const oResolve = resolve;
        resolve = (...args) => {
          console.log(`History message reply`, ...args);
          return oResolve(...args);
        };
      }
      if ( DEBUG.commands ) {
        const isFetchDomain = message.method.startsWith("Fetch.");
        const isCaptureScreenshot = message.method == "Page.captureScreenshot";
        const isScreenshotAck = message.method == "Page.screencastFrameAck";
        const isNeither = !(isCaptureScreenshot || isScreenshotAck || (isFetchDomain && DEBUG.dontShowFetchDomain));
        const displayCommand = isNeither || (DEBUG.acks && isScreenshotAck) || (DEBUG.shotDebug && isCaptureScreenshot);
        if ( displayCommand ) {
          //console.log({send:message});
          promise = promise.then(resp => {
            if ( resp && resp.data ) {
              if ( resp.data.length < 1000 ) {
                console.log({message,resp});
              } else {
                console.log(JSON.stringify({message,resp:'[long response]'},null,2));
              }
            } else {
              console.log(JSON.stringify({message,resp: resp || '[no response]'},null,2));
            }
            return resp;
          }).catch(err => {
            console.warn({sendFail:err}); 
          });
        }
      }
      if ( DEBUG.showErrorSources ) {
        resolve._originalCommand = message;
      }
      Resolvers[key] = resolve; 
      if ( DEBUG.showErrorSources ) {
        lastCommands.unshift(message);
        if ( lastCommands.length > LAST_COMMANDS_WINDOW ) {
          lastCommands.length = LAST_COMMANDS_WINDOW;
        }
      }
      if ( DEBUG.logFileCommands && LOG_FILE.Commands.has(message.method) ) {
        let stack = '';
        let source;
        if ( DEBUG.noteCallStackInLog ) {
          stack = (new Error).stack; 
        }
        if ( message.method == "Page.addScriptToEvaluateOnNewDocument" ) {
          source = message.params.source;
          message.params.source = message.params.source.slice(0,120) + (source.length > 120 ? '...' : '');
        }
        console.info(`Logging`, message, stack);
        if ( source ) {
          message.params.source = source;
        }
        fs.appendFileSync(LOG_FILE.FileHandle, JSON.stringify({
          timestamp: (new Date).toISOString(),
          message,
        },null,2)+"\n");
      }
      if ( message.method == "Page.captureScreenshot" ) {
        DEBUG.showBlockedCaptureScreenshots && console.info("Blocking page capture screenshot");
        if ( CONFIG.blockAllCaptureScreenshots && message.blockExempt != true ) {
          return Promise.resolve(true);
        }
        if ( message.blockExempt ) {
          DEBUG.debugCast && console.log(`NOT blocking this screenshot as it is blockExempt`);
        }
      }
      if ( message.method == "Page.screencastFrameAck" ) {
        if ( message.params.sessionId === undefined ) {
          message.params.sessionId = 1;
        }
      }
      try {
        socket.send(JSON.stringify(message));
      } catch(e) {
        console.warn("Error sending to chrome", e);
        Zombie.sendErrorToClient(e);
      }
      return promise;
    }

    async function handle(message) {
      const stringMessage = message;
      message = JSON.parse(message);
      const {sessionId} = message;
      const {method} = message;
      const {id, result, error} = message;

      if ( error ) {
        if ( DEBUG.errors || DEBUG.showErrorSources ) {
          console.warn("\nBrowser backend Error message", message);
          const key = `${sessionId||ROOT_SESSION}:${id}`;
          const originalCommand = Resolvers?.[key]?._originalCommand;
          if ( originalCommand ) {
            console.log(`Original command that caused error`, originalCommand);
          } else {
            console.log(`Can't find original command as no id, but last ${LAST_COMMANDS_WINDOW} commands sent were:`, lastCommands);
          }
          console.log('');
        }
      } else if ( id ) {
        const key = `${sessionId||ROOT_SESSION}:${id}`;
        const resolve = Resolvers[key];
        if ( ! resolve ) {
          console.warn(`No resolver for key`, key, stringMessage.slice(0,140));
        } else {
          Resolvers[key] = undefined;
          try {
            await resolve(result);
          } catch(e) {
            console.warn(`Resolver failed`, e, key, stringMessage.slice(0,140), resolve);
          }
        }
      } else if ( method ) {
        // logging related
        {
          let img;
          if ( method == "Page.screencastFrame" ) {
            img = message.params.data;
            message.params.data = "... img data ...";
          }
          if ( DEBUG.events ) {
            console.log(`Event: ${method}\n`, JSON.stringify(message, null, 2));
          }
          if ( DEBUG.logFileCommands && LOG_FILE.Commands.has(method) ) {
            console.log(`Event received: ${method}`);
            console.info(JSON.stringify(message, null, 2));
            if ( DEBUG.showFrameTreeOnFrameChanges ) {
              if ( method == "Page.frameAttached" || method == "Page.frameDetached" ) {
                const {frameTree} = await send("Page.getFrameTree", {}, sessionId);
                const max = 0; // world.size /* max frames to enumerate, 0 is all */
                const frameList = enumerateFrames(frameTree, max);
                console.log(`Frame list`, frameList);
              }
            }
            // append to log file
            {
              fs.appendFileSync(LOG_FILE.FileHandle, JSON.stringify({
                timestamp: (new Date).toISOString(),
                message,
              },null,2)+"\n");
            }
          }
          if ( img ) {
            message.params.data = img;
          }
        }
        const listeners = Handlers[method];
        if ( Array.isArray(listeners) ) {
          for( const func of listeners ) {
            try {
              await func({message, sessionId});
            } catch(e) {
              console.warn(`Listener failed`, method, e, func.toString().slice(0,140), stringMessage.slice(0,140));
            }
          }
        }
      } else {
        console.warn(`Unknown message on socket`, message);
      }
    }

    function on(method, handler) {
      let listeners = Handlers[method]; 
      if ( ! listeners ) {
        Handlers[method] = listeners = [];
      }
      listeners.push(wrap(handler));
    }

    function ons(method, handler) {
      let listeners = Handlers[method]; 
      if ( ! listeners ) {
        Handlers[method] = listeners = [];
      }
      listeners.push(handler);
    }

    function wrap(fn) {
      return ({message}) => fn(message.params)
    }
  } catch(e) {
    const resp = await fetch(`http://${
      DEBUG.useLoopbackIP ? '127.0.0.1' : 'localhost'
    }:${port}/json/version`);
    console.log(`Error when starting browser: ${e}`, e);
    console.log(`Response: ${await resp.text()}`);
    await sleep(1000);
    process.exit(1);
  }
}

function getFileFromURL(url) {
  url = new URL(url); 
  const {pathname} = url;
  const nodes = pathname.split('/');
  let lastNode = nodes.pop();
  if ( ! lastNode ) {
    DEBUG.val > DEBUG.med && console.warn({url, nodes, fileNameError: Error(`URL cannot be parsed to get filename`)});
    return `download${Date.now()}`;
  }
  const name = unescape(lastNode);
  // MARK 2
  DEBUG.val && console.log({name});
  return name;
}

function convertRemoteObjectToString({type, className, value, unserializableValue, description}) {
  let asString;

  if ( value ) {
    try {
      asString = JSON.stringify(value);  
    } finally { void 0; }
  } else if ( unserializableValue ) {
    try {
      asString = unserializableValue + "";
    } finally { void 0; }
  }

  return `${type}:${className||type}:${asString||''}:${description||'[unknown value]'}`;
}

function enumerateFrames(tree, max = 0) {
  const stack = [tree];
  const frames = [];

  while(stack.length) {
    const {frame,childFrames} = stack.shift();
    if ( childFrames ) {
      stack.push(...childFrames);
    }
    frames.push(frame);
    if ( DEBUG.decorateFrameListWithContexts && FrameContexts?.[frame.id]?.size ) {
      frame.contexts = JSON.stringify([...FrameContexts[frame.id].values()], null, 2)
    }
    if ( max && frames.length > max ) {
      return frames;  // only check so far if we know we will have a mismatch with world number
    }
  }

  return frames;
}

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

async function fetchWithTor(url, options = {}) {
  let agent;
  if ( options.customProxy ) {
    agent = options.customProxy;
    delete options.customProxy;
  }
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;

    const requestOptions = {
      agent,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const request = protocol.request(url, requestOptions, (res) => {
      const chunks = [];
      res.on('data', (chunk) => {
        chunks.push(chunk);
      });
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          headers: res.headers,
          text: () => Promise.resolve(buffer.toString()),
          arrayBuffer: () => Promise.resolve(buffer),
          contentType: res.headers['content-type']
        });
      });
    });

    request.on('error', (error) => {
      reject(error);
    });

    request.end();
  });
}
