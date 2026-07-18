import React, { useEffect, useState } from 'react';
import { Engine } from '../../engine/Engine';
import { browserFileSystemAccess } from '../../engine/gameRes/browserFileSystemAccess';
import { StorageFileExplorer } from './fileExplorer/StorageFileExplorer';
import AppLogger from '../../util/logger';

const GameResourcesViewer: React.FC = () => {
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [storageDirHandle, setStorageDirHandle] = useState<FileSystemDirectoryHandle | null>(null);
    const [fileSystemChanged, setFileSystemChanged] = useState(false);
    const [showExplorer, setShowExplorer] = useState(false);

    useEffect(() => {
        try {
            if (Engine.rfs) {
                const rootDirHandle = Engine.rfs.getRootDirectoryHandle();
                if (rootDirHandle) {
                    setStorageDirHandle(rootDirHandle);
                    AppLogger.info('[GameResourcesViewer] Storage directory handle obtained from Engine.rfs');
                    return;
                }
                AppLogger.warn('[GameResourcesViewer] Engine.rfs.getRootDirectoryHandle() returned null');
                setError('No storage directory handle available');
                return;
            }
            AppLogger.warn('[GameResourcesViewer] Engine.rfs not available');
            setError('Real File System (RFS) not initialized');
        }
        catch (loadError: any) {
            AppLogger.error('[GameResourcesViewer] Error getting storage directory handle:', loadError);
            setError(`Failed to get storage handle: ${loadError.message}`);
        }
    }, []);

    const isSystemFile = (path: string): boolean => {
        const systemPatterns: (string | RegExp)[] = [
            /^\/[^\/]*\.mix$/i,
            /^\/[^\/]*\.bag$/i,
            /^\/[^\/]*\.idx$/i,
            /^\/[^\/]*\.ini$/i,
            /^\/[^\/]*\.csf$/i,
        ];
        return systemPatterns.some(pattern => typeof pattern === 'string'
            ? path.toLowerCase() === pattern.toLowerCase()
            : pattern.test(path));
    };

    const getSystemStatus = () => {
        const vfsStatus = Engine.vfs ? '✅ Initialized' : '❌ Not initialized';
        const rfsStatus = Engine.rfs ? '✅ Initialized' : '❌ Not initialized';
        const vfsArchiveCount = Engine.vfs ? Engine.vfs.listArchives().length : 0;
        const storageReady = !!storageDirHandle;
        const fsAccessReady = !!browserFileSystemAccess.adapters.indexeddb;
        return { vfsStatus, rfsStatus, vfsArchiveCount, storageReady, fsAccessReady };
    };

    const { vfsStatus, rfsStatus, vfsArchiveCount, storageReady, fsAccessReady } = getSystemStatus();

    return (
        <div style={{
            height: '100vh',
            overflow: 'auto',
            padding: '20px',
            fontFamily: 'Arial, sans-serif',
            boxSizing: 'border-box'
        }}>
            <h1>RA2 Web - Game Resource Storage Browser</h1>

            <div style={{ marginBottom: '20px' }}>
                <h2>System Status</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
                    <div style={{ padding: '10px', border: '1px solid #ccc', borderRadius: '5px' }}>
                        <strong>Virtual File System (VFS)</strong>
                        <div>Status: {vfsStatus}</div>
                        <div>Archives: {vfsArchiveCount}</div>
                    </div>
                    <div style={{ padding: '10px', border: '1px solid #ccc', borderRadius: '5px' }}>
                        <strong>Real File System (RFS)</strong>
                        <div>Status: {rfsStatus}</div>
                        <div>Storage handle: {storageReady ? '✅ Ready' : '❌ Not ready'}</div>
                    </div>
                    <div style={{ padding: '10px', border: '1px solid #ccc', borderRadius: '5px' }}>
                        <strong>ESM Modules</strong>
                        <div>FileSystemAccess: {fsAccessReady ? '✅ Connected' : '❌ Unavailable'}</div>
                        <div>File Explorer: ✅ TypeScript component</div>
                    </div>
                </div>
            </div>

            <div style={{ marginBottom: '20px' }}>
                <h2>Storage Browser Controls</h2>
                <div style={{ marginBottom: '10px' }}>
                    <button
                        onClick={() => {
                            setError(null);
                            setShowExplorer(true);
                        }}
                        disabled={!storageReady}
                        style={{
                            marginRight: '10px',
                            padding: '10px 20px',
                            backgroundColor: storageReady ? '#007cba' : '#ccc',
                            color: 'white',
                            border: '1px solid #ccc',
                            borderRadius: '5px',
                            cursor: storageReady ? 'pointer' : 'not-allowed'
                        }}
                    >
                        Open Storage Browser
                    </button>
                    <button
                        onClick={() => location.reload()}
                        disabled={!fileSystemChanged}
                        style={{
                            padding: '10px 20px',
                            backgroundColor: fileSystemChanged ? '#dc3545' : '#ccc',
                            color: 'white',
                            border: '1px solid #ccc',
                            borderRadius: '5px',
                            cursor: fileSystemChanged ? 'pointer' : 'not-allowed'
                        }}
                    >
                        {fileSystemChanged ? 'Exit and Reload' : 'Reload (No Changes)'}
                    </button>
                </div>
            </div>

            {error ? (
                <div style={{
                    padding: '10px',
                    backgroundColor: '#ffebee',
                    color: '#c62828',
                    borderRadius: '5px',
                    marginBottom: '10px',
                    border: '1px solid #ffcdd2'
                }}>
                    Error: {error}
                </div>
            ) : null}

            {message ? (
                <div style={{
                    padding: '10px',
                    backgroundColor: '#e8f5e8',
                    color: '#2e7d32',
                    borderRadius: '5px',
                    marginBottom: '10px',
                    border: '1px solid #c8e6c9'
                }}>
                    {message}
                </div>
            ) : null}

            {fileSystemChanged ? (
                <div style={{
                    padding: '10px',
                    backgroundColor: '#fff3cd',
                    color: '#856404',
                    borderRadius: '5px',
                    marginBottom: '10px',
                    border: '1px solid #ffeaa7'
                }}>
                    ⚠️ The file system has been modified. Reload the application to make sure your changes take effect.
                </div>
            ) : null}

            <div style={{
                marginTop: '20px',
                border: '2px solid #ccc',
                borderRadius: '5px',
                minHeight: '500px',
                backgroundColor: '#f9f9f9',
                overflow: 'hidden'
            }}>
                {!showExplorer ? (
                    <div style={{ padding: '20px', textAlign: 'center' }}>
                        <p>Click "Open Storage Browser" to start browsing game resource files.</p>
                        <p>This view shows the game files and folders persisted in browser storage.</p>
                    </div>
                ) : storageDirHandle ? (
                    <StorageFileExplorer
                        rootHandle={storageDirHandle}
                        rootLabel="Game Storage"
                        isSystemFile={isSystemFile}
                        onFileSystemChange={() => setFileSystemChanged(true)}
                        onFileOpen={(path, entry) => setMessage(`Opened file: ${entry.name} (path: ${path})`)}
                        onInfo={(info) => setMessage(info)}
                        promptForText={async (promptText) => {
                            const value = window.prompt(promptText);
                            return value === null ? undefined : value;
                        }}
                        confirmAction={async (confirmText) => window.confirm(confirmText)}
                        showAlert={async (alertText, title) => window.alert(title ? `${title}\n\n${alertText}` : alertText)}
                    />
                ) : (
                    <div style={{ padding: '20px', textAlign: 'center' }}>
                        <p>Waiting for the storage system to become ready...</p>
                        <p>Make sure game resources have been imported and the RFS system initialized correctly.</p>
                    </div>
                )}
            </div>

            <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#f0f0f0', borderRadius: '5px' }}>
                <h3>Instructions</h3>
                <ul>
                    <li><strong>Storage browser</strong>: Browse game resource files stored in browser storage</li>
                    <li><strong>System files</strong>: Core game files such as .mix, .bag, and .ini are protected; a warning is shown before deletion</li>
                    <li><strong>File operations</strong>: Supports uploading, deleting, creating folders, and more</li>
                    <li><strong>Debug tool</strong>: This component is used to debug mix file reading issues and resource management</li>
                    <li><strong>ESM migration</strong>: The browser no longer depends on the legacy file-explorer.js under public</li>
                </ul>
            </div>
        </div>
    );
};

export default GameResourcesViewer;
