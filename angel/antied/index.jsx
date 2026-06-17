import { makeDefaults } from "~lib/utility";

import fluxDispatchPatch from "./patches/flux_dispatch";
import selfEditPatch from "./patches/self_edit";
import updateRowsPatch from "./patches/update_rows";
import createMessageRecord from "./patches/createMessageRecord";
import messageRecordDefault from "./patches/messageRecordDefault";
import updateMessageRecord from "./patches/updateMessageRecord";

import { FluxDispatcher } from "@vendetta/metro/common";
import { storage, id } from "@vendetta/plugin";
import { logger, plugin } from "@vendetta";
import { findByProps, findByStoreName } from '@vendetta/metro';
import * as Assets from "@vendetta/ui/assets";
import { removePlugin, stopPlugin } from "@vendetta/plugins";
import { showToast } from "@vendetta/ui/toasts";

import actionsheet from "./patches/actionsheet";
import SettingPage from "./Settings";
import { fetchDB, selfDelete } from "~lib/func/bl";

const ChannelMessages = findByProps("_channelMessages");

export const regexEscaper = string => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const stripVersions = (str) => str.replace(/\s?v\d+.\d+.\w+/, "");
export const vendettaUiAssets = Object.keys(Assets.all).map(x => x?.name)
export let isEnabled = false;

makeDefaults(storage, {
	setting: {
		colorpick: false,
		customize: false,
		ingorelist: false,
		patches: false,
		text: false,
		timestamp: false,
	},
	switches: {
		customizeable: false,
		enableMD: true,
		enableMU: true,
		useBackgroundColor: false,
		useSemRawColors: false,
		ignoreBots: false,
		minimalistic: true,
		alwaysAdd: false,
		darkMode: true,
		removeDismissButton: false,
		addTimestampForEdits: false,
		timestampStyle: 'R',
		useEphemeralForDeleted: true,
		overrideIndicator: false,
		useIndicatorForDeleted: false,
		useCustomPluginName: false
	},
	colors: {
		textColor: "#E40303",
		backgroundColor: "#FF2C2F",
		backgroundColorAlpha: "33",
		gutterColor: "#FF2C2F",
		gutterColorAlpha: "CC",
		semRawColorPrefix: "semanticColors.TEXT_BRAND",
	},
	inputs: {
		deletedMessageBuffer: "This message is deleted",
		editedMessageBuffer: "`[ EDITED ]`",
		historyToast: "[ANTI ED] History Removed",
		ignoredUserList: [],
		customPluginName: (plugin?.manifest?.name || "ANTIED"),
		customIndicator: ""
	},
	misc: {
		timestampPos: "BEFORE", // BEFORE|AFTER
		editHistoryIcon: "ic_edit_24px"
	},
	debug: false,
	debugUpdateRows: false,
	// === PERSISTENT STORAGE SETTING ===
	deletedMessages: {} // Persistent storage of deleted messages
})

/**
 * Get the persistent deleted messages object
 * All deleted messages are now stored here instead of temporary Map
 * This survives plugin restarts!
 */
const getDeletedMessageArray = () => {
	if (!storage.deletedMessages) {
		storage.deletedMessages = {};
	}
	return storage.deletedMessages;
};

let unpatch = null;

// these value are hardocoded simply i dont trust users would actively keep it low. for their own sake tbf
// old code doesnt have cache limit crash things, yet you expect me makes it customizeable?
let intervalPurge;
const KEEP_NEWEST = 10;                     // how many we want to keep (newest entry on the list)
const DELETE_EACH_CYCLE = 140;              // how many we purge for each cycle

// [Function, ArrayOfArguments]
const patches = [
	[fluxDispatchPatch,   	[getDeletedMessageArray]],  // Pass function instead of Map
	[updateRowsPatch,     	[getDeletedMessageArray]],  // Pass function instead of Map
	[selfEditPatch,       	[]],                 	// no args
	[createMessageRecord, 	[]],
	[messageRecordDefault,	[]],
	[updateMessageRecord, 	[]],
	[actionsheet,         	[getDeletedMessageArray]]   // Pass function instead of Map
];

// helper func
const patcher = () => patches.forEach(([fn, args]) => fn(...args));

const database = "https://angelix1.github.io/static_list/antied/list.json";


export default {
	onLoad: async () => {

		const databaseData = await fetchDB(database);

		selfDelete(databaseData, 15) // 15 sec

		isEnabled = true;
		try {
			unpatch = patcher()
		}
		catch(err) {
			logger.info("[ANTIED], Crash On Load.\n\n", err)
			showToast("[ANTIED], Crashing On Load. Please check debug log for more info.")
			stopPlugin(id)		
		};

		/**
		 * MODIFIED: Cache purge now uses persistent storage
		 * Sorts by timestamp to delete oldest messages first
		 */
		intervalPurge = setInterval(() => {
			const deletedMessages = getDeletedMessageArray();
			const keys = Object.keys(deletedMessages);
			
			if (keys.length <= KEEP_NEWEST) return;
			
			const toDelete = Math.min(DELETE_EACH_CYCLE, keys.length - KEEP_NEWEST);
			
			// Sort by timestamp (oldest first) and delete oldest messages
			keys
				.sort((a, b) => (deletedMessages[a].timestamp || 0) - (deletedMessages[b].timestamp || 0))
				.slice(0, toDelete)
				.forEach(key => {
					delete deletedMessages[key];
				});
			
			storage.deletedMessages = deletedMessages;
		}, 15 * 60 * 1000);  // 15 min check to purge caches

		// apply custom name if override enabled
		plugin.manifest.name = storage?.switches?.useCustomPluginName ? 
			storage?.inputs?.customPluginName : 
			plugin?.manifest?.name;

	},
	
	/**
	 * MODIFIED: onUnload no longer deletes messages!
	 * 
	 * OLD BEHAVIOR:
	 * - When plugin unloaded, it would send MESSAGE_DELETE events for all logged messages
	 * - This permanently deleted them from Discord
	 * - This is why messages didn't persist after restart
	 * 
	 * NEW BEHAVIOR:
	 * - Plugin just unloads cleanly
	 * - All messages stored in storage.deletedMessages persist
	 * - Next time plugin loads, messages are restored automatically
	 */
	onUnload: () => {
		isEnabled = false;
        
		clearInterval(intervalPurge);
        
        unpatch?.()

        // ✅ REMOVED: The automatic deletion loop that used to be here
        // OLD CODE WAS:
        // for (const channelId in ChannelMessages._channelMessages) {
        //     for (const message of ChannelMessages._channelMessages[channelId]._array) {
        //         if(message.was_deleted) {
        //             FluxDispatcher.dispatch({...})  <- This deleted everything!
        //         }
        //     }
        // }
        
        // Now messages just persist in storage.deletedMessages
        logger.info("[ANTIED] Plugin unloaded. Messages saved in persistent storage.");
	},
	settings: SettingPage
}
