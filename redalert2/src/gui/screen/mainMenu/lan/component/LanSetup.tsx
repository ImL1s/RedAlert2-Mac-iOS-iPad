import React, { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import { ChatHistory } from '@/gui/chat/ChatHistory';
import { List, ListItem } from '@/gui/component/List';
import { LobbyForm } from '@/gui/screen/mainMenu/lobby/component/LobbyForm';
import { LobbyType, PlayerStatus } from '@/gui/screen/mainMenu/lobby/component/viewmodel/lobby';
import { LanRecentPlayRecord } from '@/gui/screen/mainMenu/lan/LanRecentPlay';
import { RECIPIENT_ALL } from '@/network/gservConfig';
import { LanMeshSession, LanMeshSnapshot } from '@/network/lan/LanMeshSession';
import { LanRoomSession, LanRoomSnapshot } from '@/network/lan/LanRoomSession';
import { PregameController } from '@/gui/screen/mainMenu/lobby/PregameController';
import { QrCodeCard } from '@/gui/screen/mainMenu/lan/component/QrCodeCard';
import { QrScannerPanel } from '@/gui/screen/mainMenu/lan/component/QrScannerPanel';

interface Strings {
    get(key: string, ...args: any[]): string;
}

interface UiChatMessage {
    from?: string;
    to?: {
        type: number;
        name: string;
    };
    text: string;
    time?: Date;
}

interface LanSetupProps {
    strings: Strings;
    meshSession: LanMeshSession;
    roomSession: LanRoomSession;
    chatHistory: ChatHistory;
    pregameController: PregameController;
    resetNonce?: number;
    inviteNonce?: number;
    joinNonce?: number;
    recentSessions: LanRecentPlayRecord[];
    onStartGame: () => Promise<void>;
    onLeaveRoom: () => Promise<void>;
    onChangeMap: () => Promise<void>;
    onToggleReady: () => Promise<void>;
    onHostPregameChanged: () => void;
    onCommitName?: (name: string) => void;
}

const MAX_MESSAGES = 180;
function trimMessages(messages: UiChatMessage[]): UiChatMessage[] {
    if (messages.length <= MAX_MESSAGES) {
        return messages;
    }
    return messages.slice(messages.length - MAX_MESSAGES);
}

function createSystemMessage(text: string): UiChatMessage {
    return { text };
}

function createChatMessage(from: string, text: string, timestamp: number): UiChatMessage {
    return {
        from,
        to: {
            type: 0,
            name: RECIPIENT_ALL,
        },
        text,
        time: new Date(timestamp),
    };
}

function createInitialMessages(): UiChatMessage[] {
    return [];
}

function shouldSurfaceSystemLog(text: string): boolean {
    return /fail|error|not support|unsupport|unable|cannot|timed out|interrupt|disconnect|closed|denied|not allow|unrecogniz|exception/i.test(text);
}

function describeRoomTone(roomSnapshot: LanRoomSnapshot): 'good' | 'warn' | 'bad' {
    if (roomSnapshot.canStart) {
        return 'good';
    }
    if (roomSnapshot.isRoomActive || roomSnapshot.mesh.isInRoom) {
        return 'warn';
    }
    return 'bad';
}

function describeCompactRoomState(roomSnapshot: LanRoomSnapshot): string {
    if (!roomSnapshot.isRoomActive) {
        return 'Waiting for host sync';
    }
    if (roomSnapshot.canStart) {
        return 'All connected';
    }
    if (roomSnapshot.roomState && !roomSnapshot.roomState.gameOpts.mapOfficial) {
        return 'Waiting for map sync';
    }
    return 'Waiting for members to connect';
}

function describeMemberRoleTone(member: LanRoomSnapshot['members'][number]): 'good' | 'warn' | 'bad' {
    if (member.isHost || member.ready) {
        return 'good';
    }
    return member.isConnected ? 'warn' : 'bad';
}

function describeCustomMapTransfer(roomSnapshot: LanRoomSnapshot): { text: string; tone: 'good' | 'warn' | 'bad' } | undefined {
    if (!roomSnapshot.roomState || roomSnapshot.roomState.gameOpts.mapOfficial) {
        return undefined;
    }

    const failedMember = roomSnapshot.members.find((member) => member.mapTransfer.status === 'error');
    if (failedMember) {
        return {
            text: `Map sync failed: ${failedMember.name}`,
            tone: 'bad',
        };
    }

    const completedCount = roomSnapshot.members.filter((member) => member.mapTransfer.status === 'complete').length;
    if (completedCount >= roomSnapshot.members.length && roomSnapshot.members.length > 0) {
        return {
            text: 'Map sync complete',
            tone: 'good',
        };
    }

    return {
        text: `Map sync ${completedCount}/${roomSnapshot.members.length}`,
        tone: 'warn',
    };
}

function formatRecentTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    const hours = `${date.getHours()}`.padStart(2, '0');
    const minutes = `${date.getMinutes()}`.padStart(2, '0');
    return `${month}/${day} ${hours}:${minutes}`;
}

function describeRecentRole(role: LanRecentPlayRecord['role']): string {
    return role === 'host' ? 'Host' : 'Member';
}

function formatMemberSummary(record: LanRecentPlayRecord): string {
    if (!record.memberNames.length) {
        return `${record.memberCount}-player room`;
    }
    const visibleMembers = record.memberNames.slice(0, 3).join(', ');
    if (record.memberNames.length > 3) {
        return `${visibleMembers} and others · ${record.memberCount} players`;
    }
    return `${visibleMembers} · ${record.memberCount} players`;
}

export const LanSetup: React.FC<LanSetupProps> = ({
    meshSession,
    roomSession,
    chatHistory,
    pregameController,
    resetNonce = 0,
    inviteNonce = 0,
    joinNonce = 0,
    recentSessions,
    onHostPregameChanged,
    onCommitName,
}) => {
    const [meshSnapshot, setMeshSnapshot] = useState<LanMeshSnapshot>(meshSession.getSnapshot());
    const [roomSnapshot, setRoomSnapshot] = useState<LanRoomSnapshot>(roomSession.getSnapshot());
    const [messages, setMessages] = useState<UiChatMessage[]>(() => {
        const existingMessages = chatHistory.getAll() as UiChatMessage[];
        if (existingMessages.length > 0) {
            return existingMessages;
        }
        const initialMessages = createInitialMessages();
        initialMessages.forEach((message) => chatHistory.addChatMessage(message));
        return initialMessages;
    });
    const [nameInput, setNameInput] = useState(meshSession.getSnapshot().self.name);
    const [manualPayloadText, setManualPayloadText] = useState('');
    const [manualResponsePayloadText, setManualResponsePayloadText] = useState('');
    const [busy, setBusy] = useState(false);
    const [clipboardHint, setClipboardHint] = useState<string>();
    const [joinDialogOpen, setJoinDialogOpen] = useState(false);
    const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
    const [showAdvancedJoin, setShowAdvancedJoin] = useState(false);
    const [showAdvancedInvite, setShowAdvancedInvite] = useState(false);
    const lastResetNonceRef = useRef(resetNonce);
    const lastInviteNonceRef = useRef(inviteNonce);
    const lastJoinNonceRef = useRef(joinNonce);
    const appMessageLogRef = useRef<any[]>([]);

    const supported = typeof RTCPeerConnection !== 'undefined';

    const appendMessage = (message: UiChatMessage) => {
        chatHistory.addChatMessage(message);
        startTransition(() => {
            setMessages((current) => trimMessages([...current, message]));
        });
    };

    const replaceMessages = (nextMessages: UiChatMessage[]) => {
        chatHistory.reset();
        nextMessages.forEach((message) => chatHistory.addChatMessage(message));
        startTransition(() => {
            setMessages(nextMessages);
        });
    };

    const appendSystemMessage = (text: string) => {
        appendMessage(createSystemMessage(text));
    };

    useEffect(() => {
        const handleMeshSnapshot = (nextSnapshot: LanMeshSnapshot) => {
            setMeshSnapshot(nextSnapshot);
            setNameInput((current) => (current === meshSnapshot.self.name ? nextSnapshot.self.name : current));
        };
        const handleRoomSnapshot = (nextSnapshot: LanRoomSnapshot) => {
            setRoomSnapshot(nextSnapshot);
        };
        const handleMeshLog = (entry: { text: string }) => {
            if (shouldSurfaceSystemLog(entry.text)) {
                appendSystemMessage(entry.text);
            }
        };
        const handleRoomLog = (entry: { text: string }) => {
            if (shouldSurfaceSystemLog(entry.text)) {
                appendSystemMessage(entry.text);
            }
        };
        const handleChat = (entry: { from: { name: string }; text: string; timestamp: number }) => {
            appendMessage(createChatMessage(entry.from.name, entry.text, entry.timestamp));
        };
        const handleAppMessage = (entry: { from: unknown; payload: unknown; timestamp: number }) => {
            appMessageLogRef.current = [...appMessageLogRef.current.slice(-49), {
                from: entry.from,
                payload: entry.payload,
                timestamp: entry.timestamp,
            }];
        };

        meshSession.onSnapshotChange.subscribe(handleMeshSnapshot);
        roomSession.onSnapshotChange.subscribe(handleRoomSnapshot);
        meshSession.onLog.subscribe(handleMeshLog);
        roomSession.onLog.subscribe(handleRoomLog);
        meshSession.onChat.subscribe(handleChat);
        meshSession.onAppMessage.subscribe(handleAppMessage);

        return () => {
            meshSession.onSnapshotChange.unsubscribe(handleMeshSnapshot);
            roomSession.onSnapshotChange.unsubscribe(handleRoomSnapshot);
            meshSession.onLog.unsubscribe(handleMeshLog);
            roomSession.onLog.unsubscribe(handleRoomLog);
            meshSession.onChat.unsubscribe(handleChat);
            meshSession.onAppMessage.unsubscribe(handleAppMessage);
        };
    }, [chatHistory, meshSession, roomSession, meshSnapshot.self.name]);

    useEffect(() => {
        if (lastResetNonceRef.current === resetNonce) {
            return;
        }
        lastResetNonceRef.current = resetNonce;
        setManualPayloadText('');
        setManualResponsePayloadText('');
        setClipboardHint(undefined);
        setJoinDialogOpen(false);
        setInviteDialogOpen(false);
        setShowAdvancedJoin(false);
        setShowAdvancedInvite(false);
        const nextSnapshot = meshSession.getSnapshot();
        setMeshSnapshot(nextSnapshot);
        setRoomSnapshot(roomSession.getSnapshot());
        setNameInput(nextSnapshot.self.name);
        replaceMessages(createInitialMessages());
    }, [meshSession, resetNonce, roomSession]);

    useEffect(() => {
        if (lastInviteNonceRef.current === inviteNonce) {
            return;
        }
        lastInviteNonceRef.current = inviteNonce;
        setInviteDialogOpen(true);
    }, [inviteNonce]);

    useEffect(() => {
        if (lastJoinNonceRef.current === joinNonce) {
            return;
        }
        lastJoinNonceRef.current = joinNonce;
        setJoinDialogOpen(true);
    }, [joinNonce]);

    useEffect(() => {
        if (inviteDialogOpen && meshSnapshot.isInRoom) {
            void handleCreateInvite();
        }
    }, [inviteDialogOpen, meshSnapshot.isInRoom]);

    useEffect(() => {
        if (!inviteDialogOpen || roomSnapshot.canInvite) {
            return;
        }
        setInviteDialogOpen(false);
        setShowAdvancedInvite(false);
        setClipboardHint(undefined);
    }, [inviteDialogOpen, roomSnapshot.canInvite]);

    useEffect(() => {
        if (roomSnapshot.isRoomActive && joinDialogOpen) {
            setJoinDialogOpen(false);
            setShowAdvancedJoin(false);
        }
    }, [joinDialogOpen, roomSnapshot.isRoomActive]);

    useEffect(() => {
        const debugRoot = ((window as any).__ra2debug ??= {});
        debugRoot.lan = {
            meshSnapshot,
            roomSnapshot,
        };
        debugRoot.lanApi = {
            sendAppMessage: (payload: unknown) => meshSession.broadcastAppMessage(payload),
            getAppMessages: () => appMessageLogRef.current.slice(),
        };
    }, [meshSnapshot, roomSnapshot]);

    const commitName = () => {
        meshSession.updateSelfName(nameInput);
        const nextSelf = meshSession.getSnapshot().self;
        setMeshSnapshot(meshSession.getSnapshot());
        setNameInput(nextSelf.name);
        onCommitName?.(nextSelf.name);
        if (roomSnapshot.isHost && roomSnapshot.roomState) {
            pregameController.updateSelfName(nextSelf.name);
            onHostPregameChanged();
        }
    };

    const handleCreateInvite = async () => {
        if (!supported) {
            appendSystemMessage('This browser does not support WebRTC.');
            return;
        }
        if (!roomSession.getSnapshot().canInvite) {
            appendSystemMessage('There are no open player slots. Open a slot before inviting.');
            return;
        }
        setBusy(true);
        try {
            commitName();
            await meshSession.createRoomInvite();
            setMeshSnapshot(meshSession.getSnapshot());
            setClipboardHint(undefined);
        }
        catch (error) {
            appendSystemMessage((error as Error).message);
        }
        finally {
            setBusy(false);
        }
    };

    const handleImportPayload = async (payloadText?: string) => {
        if (!supported) {
            appendSystemMessage('This browser does not support WebRTC.');
            return;
        }
        const nextPayload = (payloadText ?? manualPayloadText).trim();
        if (!nextPayload) {
            appendSystemMessage('Scan a QR code first, or paste the QR code content into the text box.');
            return;
        }
        setBusy(true);
        try {
            commitName();
            await meshSession.importPayload(nextPayload);
            setMeshSnapshot(meshSession.getSnapshot());
            setManualPayloadText(nextPayload);
            setClipboardHint(undefined);
        }
        catch (error) {
            appendSystemMessage((error as Error).message);
            throw error;
        }
        finally {
            setBusy(false);
        }
    };

    const handleCopyPayload = async () => {
        if (!meshSnapshot.activeQrPayloadText) {
            appendSystemMessage('There is no QR code content to copy.');
            return;
        }
        try {
            await navigator.clipboard.writeText(meshSnapshot.activeQrPayloadText);
            setClipboardHint('Copied to clipboard');
            appendSystemMessage('QR code content copied to clipboard.');
        }
        catch {
            setClipboardHint('Copy failed. Please copy manually.');
            appendSystemMessage('The browser does not allow clipboard writes. Please copy manually.');
        }
    };

    const handlePastePayload = async () => {
        try {
            const text = await navigator.clipboard.readText();
            setManualPayloadText(text);
            appendSystemMessage('QR code content read from clipboard.');
        }
        catch {
            appendSystemMessage('The browser does not allow clipboard reads. Please paste manually.');
        }
    };

    const handleSendMessage = async ({ value }: { value: string }) => {
        try {
            await meshSession.sendChat(value);
        }
        catch (error) {
            appendSystemMessage((error as Error).message);
        }
    };

    const submitChatMessage = (message: any) => {
        const value = typeof message === 'string' ? message : message?.value;
        if (typeof value === 'string' && value.trim()) {
            void handleSendMessage({ value });
        }
    };

    const waitingMode = roomSnapshot.isRoomActive || meshSnapshot.isInRoom;
    const selfAssignment = roomSnapshot.roomState?.humanAssignments.find((assignment) => assignment.peerId === meshSnapshot.self.id);
    const activeSlotIndex = selfAssignment?.slotIndex ?? 0;
    const selfMember = roomSnapshot.members.find((member) => member.isSelf);
    const customMapTransfer = describeCustomMapTransfer(roomSnapshot);
    const latestRecentSession = recentSessions[0];
    const waitingStatusStrip = waitingMode ? (
        <div className="lan-room-status-strip">
            <div className="lan-status-chip">
                Room <strong>{meshSnapshot.roomId ?? '--'}</strong>
            </div>
            <div className="lan-status-chip">
                Members <strong data-lan-stat="members">{roomSnapshot.members.length || meshSnapshot.members.length}</strong>
                <span className="lan-status-divider">/</span>
                Direct <strong data-lan-stat="direct-peers">{meshSnapshot.directPeerCount}</strong>
            </div>
            <div className={`lan-status-chip tone-${describeRoomTone(roomSnapshot)}`}>
                {describeCompactRoomState(roomSnapshot)}
            </div>
            {selfMember ? (
                <div className={`lan-status-chip tone-${describeMemberRoleTone(selfMember)}`}>
                    {selfMember.isHost ? 'You are the host' : selfMember.ready ? 'Ready' : 'Not ready'}
                </div>
            ) : null}
            {customMapTransfer ? (
                <div className={`lan-status-chip tone-${customMapTransfer.tone}`}>
                    {customMapTransfer.text}
                </div>
            ) : null}
        </div>
    ) : null;

    const formProps = useMemo(() => {
        if (!roomSnapshot.roomState) {
            return undefined;
        }

        pregameController.hydrate({
            gameOpts: roomSnapshot.roomState.gameOpts,
            slotsInfo: roomSnapshot.roomState.slotsInfo,
            currentMapFile: roomSession.getResolvedCustomMapFile(),
        });

        const baseProps = pregameController.createLobbyFormProps({
            lobbyType: roomSnapshot.isHost ? LobbyType.MultiplayerHost : LobbyType.MultiplayerGuest,
            activeSlotIndex,
            messages,
            localUsername: meshSnapshot.self.name,
            channels: [RECIPIENT_ALL],
            chatHistory: chatHistory as any,
            onSendMessage: submitChatMessage,
            onStateChange: roomSnapshot.isHost ? onHostPregameChanged : undefined,
            decoratePlayerSlot: (playerSlot: any, _slotInfo: any, slotIndex: number) => {
                const assignment = roomSnapshot.roomState?.humanAssignments.find((candidate) => candidate.slotIndex === slotIndex);
                if (!assignment) {
                    return;
                }
                const member = roomSnapshot.members.find((candidate) => candidate.peerId === assignment.peerId);
                playerSlot.status = member?.isHost
                    ? PlayerStatus.Host
                    : member?.ready
                        ? PlayerStatus.Ready
                        : PlayerStatus.NotReady;
            },
        });

        if (!roomSnapshot.isHost && selfAssignment) {
            const requestOwnSlotConfig = (updater: (slot: any) => { countryId: number; colorId: number; startPos: number; teamId: number }) => {
                const slot = baseProps.playerSlots[selfAssignment.slotIndex];
                const next = updater(slot);
                void roomSession.requestSlotConfig(selfAssignment.slotIndex, next);
            };
            baseProps.onCountrySelect = (country: string) => {
                requestOwnSlotConfig((slot) => ({
                    countryId: pregameController.getCountryIdByName(country),
                    colorId: pregameController.getColorIdByName(slot.color),
                    startPos: slot.startPos,
                    teamId: slot.team,
                }));
            };
            baseProps.onColorSelect = (color: string) => {
                requestOwnSlotConfig((slot) => ({
                    countryId: pregameController.getCountryIdByName(slot.country),
                    colorId: pregameController.getColorIdByName(color),
                    startPos: slot.startPos,
                    teamId: slot.team,
                }));
            };
            baseProps.onStartPosSelect = (startPos: number) => {
                requestOwnSlotConfig((slot) => ({
                    countryId: pregameController.getCountryIdByName(slot.country),
                    colorId: pregameController.getColorIdByName(slot.color),
                    startPos,
                    teamId: slot.team,
                }));
            };
            baseProps.onTeamSelect = (teamId: number) => {
                requestOwnSlotConfig((slot) => ({
                    countryId: pregameController.getCountryIdByName(slot.country),
                    colorId: pregameController.getColorIdByName(slot.color),
                    startPos: slot.startPos,
                    teamId,
                }));
            };
        }

        return baseProps;
    }, [activeSlotIndex, chatHistory, meshSnapshot.self.id, meshSnapshot.self.name, messages, onHostPregameChanged, pregameController, roomSession, roomSnapshot, selfAssignment]);

    return (
        <div className="lobby-form lan-setup-form lan-room-form" data-lan-view={waitingMode ? 'waiting' : 'entry'}>
            {!supported ? (
                <div className="lan-panel">
                    <h3>Unsupported Environment</h3>
                    <p>This browser has no available WebRTC implementation, so LAN connections cannot be established on this page.</p>
                </div>
            ) : !waitingMode ? (
                <div className="lan-entry-layout">
                    <div className="lan-panel lan-entry-panel lan-entry-profile-panel">
                        <div className="lan-panel-header">
                            <h3>Player Info</h3>
                            <span>Use the menu on the right to create or join a room; this panel only holds your LAN profile.</span>
                        </div>
                        <div className="lan-entry-profile-grid">
                            <div className="lan-entry-profile-editor">
                                <label className="lan-input-label" htmlFor="lan-self-name">
                                    Player Name
                                </label>
                                <input
                                    id="lan-self-name"
                                    type="text"
                                    className="lan-text-input"
                                    maxLength={24}
                                    value={nameInput}
                                    data-lan-input="self-name"
                                    onChange={(event) => setNameInput(event.target.value)}
                                    onBlur={commitName}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter') {
                                            commitName();
                                        }
                                    }}
                                />
                                <div className="lan-entry-field-hint">
                                    This name is used in the room member list, chat, and your player slot once the game starts.
                                </div>
                            </div>

                            <div className="lan-entry-profile-stats">
                                <div className="lan-entry-stat">
                                    <span>Current Identity</span>
                                    <strong>{meshSnapshot.self.name}</strong>
                                </div>
                                <div className="lan-entry-stat">
                                    <span>Browser Support</span>
                                    <strong className={supported ? 'tone-good' : 'tone-bad'}>
                                        {supported ? 'WebRTC available' : 'Unavailable'}
                                    </strong>
                                </div>
                                <div className="lan-entry-stat">
                                    <span>Last Room</span>
                                    <strong>{latestRecentSession?.roomId ?? '--'}</strong>
                                </div>
                                <div className="lan-entry-stat">
                                    <span>Last Mode</span>
                                    <strong>{latestRecentSession?.modeLabel ?? 'No records yet'}</strong>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="lan-panel lan-entry-panel lan-entry-recent-panel">
                        <div className="lan-panel-header">
                            <h3>Recent Games</h3>
                            <span>{recentSessions.length ? `The last ${recentSessions.length} games are kept on this device.` : 'Games you play will be recorded here automatically.'}</span>
                        </div>
                        {recentSessions.length ? (
                            <List className="lan-entry-recent-list">
                                {recentSessions.map((record) => (
                                    <ListItem className="lan-entry-recent-item" key={record.gameId}>
                                        <div className="lan-entry-recent-item-top">
                                            <strong>{record.mapTitle}</strong>
                                            <span>{formatRecentTimestamp(record.timestamp)}</span>
                                        </div>
                                        <div className="lan-entry-recent-item-meta">
                                            <span className="lan-entry-recent-chip">{describeRecentRole(record.role)}</span>
                                            <span>{record.modeLabel}</span>
                                            <span>Room {record.roomId}</span>
                                            <span>{record.mapOfficial ? 'Official map' : 'Custom map'}</span>
                                        </div>
                                        <div className="lan-entry-recent-item-members">
                                            {formatMemberSummary(record)}
                                        </div>
                                    </ListItem>
                                ))}
                            </List>
                        ) : (
                            <div className="lan-entry-empty-state">
                                Use the menu on the right to create or join a room. After you finish a multiplayer game, it will show up here.
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                <div className="lan-waiting-main">
                    {formProps ? (
                        <div className="lan-room-form-shell lan-room-form-shell-compact">
                            <LobbyForm {...formProps} beforeChatContent={waitingStatusStrip} />
                        </div>
                    ) : (
                        <div className="lan-panel lan-room-loading-panel lan-room-loading-panel-compact">
                            Receiving room configuration...
                        </div>
                    )}
                </div>
            )}

            {inviteDialogOpen ? (
                <div className="lan-dialog-overlay" onClick={() => setInviteDialogOpen(false)}>
                    <div className="lan-dialog" onClick={(event) => event.stopPropagation()}>
                        <div className="lan-dialog-header">
                            <h3>Invite Players</h3>
                            <button type="button" className="lan-dialog-close" onClick={() => setInviteDialogOpen(false)}>
                                ×
                            </button>
                        </div>
                            <div className="lan-dialog-body">
                                <div className="lan-dialog-grid">
                                    <div className="lan-panel">
                                        <div className="lan-panel-header">
                                            <h3>Invite QR Code</h3>
                                            <span>The new player scans this code first.</span>
                                        </div>
                                        <QrCodeCard
                                            title={meshSnapshot.activeQrPayloadTitle ?? 'Invite QR Code'}
                                            description={meshSnapshot.activeQrPayloadDescription ?? 'Waiting for the QR code to be generated.'}
                                            payloadText={meshSnapshot.activeQrPayloadText}
                                        />
                                        <textarea
                                            className="lan-sdp-textarea"
                                            readOnly={true}
                                            value={meshSnapshot.activeQrPayloadText}
                                            data-lan-output="active-payload"
                                            placeholder="Raw QR code content."
                                        />
                                        <div className="lan-actions">
                                            <button
                                                type="button"
                                                className="dialog-button"
                                                data-lan-action="create-or-invite"
                                                disabled={busy}
                                                onClick={() => {
                                                    void handleCreateInvite();
                                                }}
                                            >
                                                Regenerate Invite QR Code
                                            </button>
                                            <button
                                                type="button"
                                                className="dialog-button"
                                                disabled={!meshSnapshot.activeQrPayloadText}
                                                data-lan-action="copy-payload"
                                                onClick={() => {
                                                    void handleCopyPayload();
                                                }}
                                            >
                                                Copy QR Code Content
                                            </button>
                                            {clipboardHint ? <span className="lan-hint">{clipboardHint}</span> : null}
                                        </div>
                                    </div>

                                    <div className="lan-panel">
                                        <div className="lan-panel-header">
                                            <h3>Receive Join Response</h3>
                                            <span>After the new player scans the invite, scan their response code back here.</span>
                                        </div>
                                        <QrScannerPanel
                                            onDetected={async (payloadText) => {
                                                await handleImportPayload(payloadText);
                                            }}
                                        />
                                        <div className="lan-actions">
                                            <button
                                                type="button"
                                                className="dialog-button"
                                                data-lan-action="toggle-invite-manual"
                                                onClick={() => setShowAdvancedInvite((current) => !current)}
                                            >
                                                {showAdvancedInvite ? 'Hide Advanced Options' : 'Show Advanced Options'}
                                            </button>
                                        </div>
                                        {showAdvancedInvite ? (
                                            <>
                                                <textarea
                                                    className="lan-sdp-textarea"
                                                    value={manualResponsePayloadText}
                                                    data-lan-input="invite-response-payload"
                                                    onChange={(event) => setManualResponsePayloadText(event.target.value)}
                                                    placeholder="Paste the join response QR code content here, then click Import."
                                                />
                                                <div className="lan-actions">
                                                    <button
                                                        type="button"
                                                        className="dialog-button"
                                                        data-lan-action="import-invite-response"
                                                        disabled={busy}
                                                        onClick={() => {
                                                            void handleImportPayload(manualResponsePayloadText).catch(() => undefined);
                                                        }}
                                                    >
                                                        Import Join Response
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="dialog-button"
                                                        disabled={busy}
                                                        onClick={async () => {
                                                            try {
                                                                const text = await navigator.clipboard.readText();
                                                                setManualResponsePayloadText(text);
                                                                appendSystemMessage('Join response read from clipboard.');
                                                            }
                                                            catch {
                                                                appendSystemMessage('The browser does not allow clipboard reads. Please paste manually.');
                                                            }
                                                        }}
                                                    >
                                                        Paste from Clipboard
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="dialog-button"
                                                        disabled={!manualResponsePayloadText}
                                                        onClick={() => setManualResponsePayloadText('')}
                                                    >
                                                        Clear
                                                    </button>
                                                </div>
                                            </>
                                        ) : (
                                            <p className="lan-join-hint">Scanning is preferred; only expand the advanced options for troubleshooting.</p>
                                        )}
                                    </div>
                                </div>
                        </div>
                    </div>
                </div>
            ) : null}

            {joinDialogOpen ? (
                <div className="lan-dialog-overlay" onClick={() => setJoinDialogOpen(false)}>
                    <div className="lan-dialog lan-dialog-wide" onClick={(event) => event.stopPropagation()}>
                        <div className="lan-dialog-header">
                            <h3>Join Room</h3>
                            <button type="button" className="lan-dialog-close" onClick={() => setJoinDialogOpen(false)}>
                                ×
                            </button>
                        </div>
                        <div className="lan-dialog-body">
                            {meshSnapshot.activeQrPayloadKind === 'join-response' ? (
                                <div className="lan-panel">
                                    <div className="lan-panel-header">
                                        <h3>Join Response QR Code</h3>
                                        <span>Show this code to the host to scan.</span>
                                    </div>
                                    <QrCodeCard
                                        title={meshSnapshot.activeQrPayloadTitle ?? 'Join Response QR Code'}
                                        description={meshSnapshot.activeQrPayloadDescription ?? 'Waiting for the host to scan this QR code.'}
                                        payloadText={meshSnapshot.activeQrPayloadText}
                                    />
                                    <textarea
                                        className="lan-sdp-textarea"
                                        readOnly={true}
                                        value={meshSnapshot.activeQrPayloadText}
                                        data-lan-output="active-payload"
                                        placeholder="Raw response QR code content."
                                    />
                                    <div className="lan-actions">
                                        <button
                                            type="button"
                                            className="dialog-button"
                                            disabled={!meshSnapshot.activeQrPayloadText}
                                            onClick={() => {
                                                void handleCopyPayload();
                                            }}
                                        >
                                            Copy Response Content
                                        </button>
                                        {clipboardHint ? <span className="lan-hint">{clipboardHint}</span> : null}
                                    </div>
                                </div>
                            ) : null}

                            <div className="lan-dialog-grid">
                                <QrScannerPanel
                                    onDetected={async (payloadText) => {
                                        await handleImportPayload(payloadText);
                                    }}
                                />

                                <div className="lan-panel">
                                    <div className="lan-panel-header">
                                        <h3>Fallback Method</h3>
                                        <span>Paste the text instead if scanning is not possible.</span>
                                    </div>
                                    <div className="lan-actions">
                                        <button
                                            type="button"
                                            className="dialog-button"
                                            data-lan-action="toggle-manual"
                                            onClick={() => setShowAdvancedJoin((current) => !current)}
                                        >
                                            {showAdvancedJoin ? 'Hide Advanced Options' : 'Show Advanced Options'}
                                        </button>
                                    </div>
                                    {showAdvancedJoin ? (
                                        <>
                                            <textarea
                                                className="lan-sdp-textarea"
                                                value={manualPayloadText}
                                                data-lan-input="manual-payload"
                                                onChange={(event) => setManualPayloadText(event.target.value)}
                                                placeholder="Paste the QR code content here, then click Import."
                                            />
                                            <div className="lan-actions">
                                                <button
                                                    type="button"
                                                    className="dialog-button"
                                                    data-lan-action="import-payload"
                                                    disabled={busy}
                                                    onClick={() => {
                                                        void handleImportPayload().catch(() => undefined);
                                                    }}
                                                >
                                                    Import QR Code Content
                                                </button>
                                                <button
                                                    type="button"
                                                    className="dialog-button"
                                                    disabled={busy}
                                                    onClick={() => {
                                                        void handlePastePayload();
                                                    }}
                                                >
                                                    Paste from Clipboard
                                                </button>
                                                <button
                                                    type="button"
                                                    className="dialog-button"
                                                    disabled={!manualPayloadText}
                                                    onClick={() => setManualPayloadText('')}
                                                >
                                                    Clear
                                                </button>
                                            </div>
                                        </>
                                    ) : (
                                        <p className="lan-join-hint">Scanning works by default; the advanced options are only a fallback.</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
};
