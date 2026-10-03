// The MRP protobuf schema, inlined so a packaged build (one bundled index.js,
// no proto/ beside it) still has it: node-appletv-remote's .proto files as
// text, plus the messages its set lacks and pyatv has (the now-playing
// player and client bookkeeping, volume changes), written to its names.
import ProtocolMessage from "node-appletv-remote/dist/proto/ProtocolMessage.proto" with { type: "text" };
import DeviceInfoMessage from "node-appletv-remote/dist/proto/DeviceInfoMessage.proto" with { type: "text" };
import SendCommandMessage from "node-appletv-remote/dist/proto/SendCommandMessage.proto" with { type: "text" };
import CryptoPairingMessage from "node-appletv-remote/dist/proto/CryptoPairingMessage.proto" with { type: "text" };
import ClientUpdatesConfigMessage from "node-appletv-remote/dist/proto/ClientUpdatesConfigMessage.proto" with { type: "text" };
import SetStateMessage from "node-appletv-remote/dist/proto/SetStateMessage.proto" with { type: "text" };
import GetStateMessage from "node-appletv-remote/dist/proto/GetStateMessage.proto" with { type: "text" };
import NotificationMessage from "node-appletv-remote/dist/proto/NotificationMessage.proto" with { type: "text" };
import KeyboardMessage from "node-appletv-remote/dist/proto/KeyboardMessage.proto" with { type: "text" };
import TextInputMessage from "node-appletv-remote/dist/proto/TextInputMessage.proto" with { type: "text" };
import GetKeyboardSessionMessage from "node-appletv-remote/dist/proto/GetKeyboardSessionMessage.proto" with { type: "text" };
import VolumeControlAvailabilityMessage from "node-appletv-remote/dist/proto/VolumeControlAvailabilityMessage.proto" with { type: "text" };
import WakeDeviceMessage from "node-appletv-remote/dist/proto/WakeDeviceMessage.proto" with { type: "text" };
import SetConnectionStateMessage from "node-appletv-remote/dist/proto/SetConnectionStateMessage.proto" with { type: "text" };
import SetHiliteModeMessage from "node-appletv-remote/dist/proto/SetHiliteModeMessage.proto" with { type: "text" };
import SetNowPlayingClientMessage from "node-appletv-remote/dist/proto/SetNowPlayingClientMessage.proto" with { type: "text" };
import PlaybackQueueRequestMessage from "node-appletv-remote/dist/proto/PlaybackQueueRequestMessage.proto" with { type: "text" };
import TransactionMessage from "node-appletv-remote/dist/proto/TransactionMessage.proto" with { type: "text" };
import UpdateClientMessage from "node-appletv-remote/dist/proto/UpdateClientMessage.proto" with { type: "text" };
import UpdateContentItemMessage from "node-appletv-remote/dist/proto/UpdateContentItemMessage.proto" with { type: "text" };
import SendButtonEventMessage from "node-appletv-remote/dist/proto/SendButtonEventMessage.proto" with { type: "text" };
import SendHIDEventMessage from "node-appletv-remote/dist/proto/SendHIDEventMessage.proto" with { type: "text" };
import CommandInfo from "node-appletv-remote/dist/proto/CommandInfo.proto" with { type: "text" };
import CommandOptions from "node-appletv-remote/dist/proto/CommandOptions.proto" with { type: "text" };
import PlayerPath from "node-appletv-remote/dist/proto/PlayerPath.proto" with { type: "text" };
import TransactionPackets from "node-appletv-remote/dist/proto/TransactionPackets.proto" with { type: "text" };
import ContentItem from "node-appletv-remote/dist/proto/ContentItem.proto" with { type: "text" };
import NowPlayingClient from "node-appletv-remote/dist/proto/NowPlayingClient.proto" with { type: "text" };
import PlaybackQueueContext from "node-appletv-remote/dist/proto/PlaybackQueueContext.proto" with { type: "text" };
import TextEditingAttributesMessage from "node-appletv-remote/dist/proto/TextEditingAttributesMessage.proto" with { type: "text" };
import NowPlayingInfo from "node-appletv-remote/dist/proto/NowPlayingInfo.proto" with { type: "text" };
import PlaybackQueue from "node-appletv-remote/dist/proto/PlaybackQueue.proto" with { type: "text" };
import SupportedCommands from "node-appletv-remote/dist/proto/SupportedCommands.proto" with { type: "text" };
import PlaybackQueueCapabilities from "node-appletv-remote/dist/proto/PlaybackQueueCapabilities.proto" with { type: "text" };
import Origin from "node-appletv-remote/dist/proto/Origin.proto" with { type: "text" };
import NowPlayingPlayer from "node-appletv-remote/dist/proto/NowPlayingPlayer.proto" with { type: "text" };
import TransactionPacket from "node-appletv-remote/dist/proto/TransactionPacket.proto" with { type: "text" };
import ContentItemMetadata from "node-appletv-remote/dist/proto/ContentItemMetadata.proto" with { type: "text" };
import LanguageOption from "node-appletv-remote/dist/proto/LanguageOption.proto" with { type: "text" };
import TextInputTraitsMessage from "node-appletv-remote/dist/proto/TextInputTraitsMessage.proto" with { type: "text" };
import TransactionKey from "node-appletv-remote/dist/proto/TransactionKey.proto" with { type: "text" };

const EXTRA = `syntax = "proto2";
import "ProtocolMessage.proto";
import "PlayerPath.proto";
import "NowPlayingClient.proto";
import "NowPlayingInfo.proto";
import "PlaybackQueue.proto";
import "SupportedCommands.proto";
import "PlaybackQueueCapabilities.proto";
import "PlaybackQueueRequestMessage.proto";
import "SetStateMessage.proto";
extend ProtocolMessage {
  optional SetNowPlayingPlayerMessage setNowPlayingPlayerMessage = 51;
  optional VolumeDidChangeMessage volumeDidChangeMessage = 56;
  optional RemoveClientMessage removeClientMessage = 57;
  optional RemovePlayerMessage removePlayerMessage = 58;
  optional SetDefaultSupportedCommandsMessage setDefaultSupportedCommandsMessage = 75;
}
message SetNowPlayingPlayerMessage { optional PlayerPath playerPath = 1; }
message VolumeDidChangeMessage { optional float volume = 1; optional string endpointUID = 2; optional string outputDeviceUID = 3; }
message RemoveClientMessage { optional NowPlayingClient client = 1; }
message RemovePlayerMessage { optional PlayerPath playerPath = 1; }
message SetDefaultSupportedCommandsMessage {
  optional NowPlayingInfo nowPlayingInfo = 1;
  optional SupportedCommands supportedCommands = 2;
  optional PlaybackQueue playbackQueue = 3;
  optional string displayID = 4;
  optional string displayName = 5;
  optional SetStateMessage.PlaybackState playbackState = 6;
  optional PlaybackQueueCapabilities playbackQueueCapabilities = 8;
  optional PlayerPath playerPath = 9;
  optional PlaybackQueueRequestMessage request = 10;
  optional double playbackStateTimestamp = 11;
}
`;

/** Every schema file by its name, as `import` lines spell them. */
export const PROTOS: Record<string, string> = {
  "ProtocolMessage.proto": ProtocolMessage,
  "DeviceInfoMessage.proto": DeviceInfoMessage,
  "SendCommandMessage.proto": SendCommandMessage,
  "CryptoPairingMessage.proto": CryptoPairingMessage,
  "ClientUpdatesConfigMessage.proto": ClientUpdatesConfigMessage,
  "SetStateMessage.proto": SetStateMessage,
  "GetStateMessage.proto": GetStateMessage,
  "NotificationMessage.proto": NotificationMessage,
  "KeyboardMessage.proto": KeyboardMessage,
  "TextInputMessage.proto": TextInputMessage,
  "GetKeyboardSessionMessage.proto": GetKeyboardSessionMessage,
  "VolumeControlAvailabilityMessage.proto": VolumeControlAvailabilityMessage,
  "WakeDeviceMessage.proto": WakeDeviceMessage,
  "SetConnectionStateMessage.proto": SetConnectionStateMessage,
  "SetHiliteModeMessage.proto": SetHiliteModeMessage,
  "SetNowPlayingClientMessage.proto": SetNowPlayingClientMessage,
  "PlaybackQueueRequestMessage.proto": PlaybackQueueRequestMessage,
  "TransactionMessage.proto": TransactionMessage,
  "UpdateClientMessage.proto": UpdateClientMessage,
  "UpdateContentItemMessage.proto": UpdateContentItemMessage,
  "SendButtonEventMessage.proto": SendButtonEventMessage,
  "SendHIDEventMessage.proto": SendHIDEventMessage,
  "CommandInfo.proto": CommandInfo,
  "CommandOptions.proto": CommandOptions,
  "PlayerPath.proto": PlayerPath,
  "TransactionPackets.proto": TransactionPackets,
  "ContentItem.proto": ContentItem,
  "NowPlayingClient.proto": NowPlayingClient,
  "PlaybackQueueContext.proto": PlaybackQueueContext,
  "TextEditingAttributesMessage.proto": TextEditingAttributesMessage,
  "NowPlayingInfo.proto": NowPlayingInfo,
  "PlaybackQueue.proto": PlaybackQueue,
  "SupportedCommands.proto": SupportedCommands,
  "PlaybackQueueCapabilities.proto": PlaybackQueueCapabilities,
  "Origin.proto": Origin,
  "NowPlayingPlayer.proto": NowPlayingPlayer,
  "TransactionPacket.proto": TransactionPacket,
  "ContentItemMetadata.proto": ContentItemMetadata,
  "LanguageOption.proto": LanguageOption,
  "TextInputTraitsMessage.proto": TextInputTraitsMessage,
  "TransactionKey.proto": TransactionKey,
  "Extra.proto": EXTRA,
};
