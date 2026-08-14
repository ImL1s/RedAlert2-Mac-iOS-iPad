package com.ammaar.ra2web

import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.net.Uri
import androidx.documentfile.provider.DocumentFile

class SafResourcePackManager(
    private val context: Context,
    private val uriParser: (String) -> Uri = { Uri.parse(it) }
) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    companion object {
        const val PREFS_NAME = "saf_resource_pack"
        const val KEY_PERSISTED_URI = "persisted_resource_pack_uri"
    }

    /**
     * Persist read permissions for a selected document tree URI and record it in SharedPreferences.
     */
    fun persistUriPermission(uri: Uri): Boolean {
        return try {
            val takeFlags = Intent.FLAG_GRANT_READ_URI_PERMISSION
            context.contentResolver.takePersistableUriPermission(uri, takeFlags)
            prefs.edit().putString(KEY_PERSISTED_URI, uri.toString()).apply()
            true
        } catch (e: SecurityException) {
            false
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Retrieve the persisted URI if it exists and still holds valid persistable read permission.
     */
    fun getPersistedUri(): Uri? {
        val uriStr = prefs.getString(KEY_PERSISTED_URI, null) ?: return null
        val uri = try {
            uriParser(uriStr)
        } catch (e: Exception) {
            return null
        }

        if (!hasPermissionGrant(uri)) {
            return null
        }

        return uri
    }

    /**
     * Checks if the app currently holds a valid persisted read permission for the given URI.
     */
    fun hasPermissionGrant(uri: Uri): Boolean {
        val persistedPermissions = try {
            context.contentResolver.persistedUriPermissions
        } catch (e: Exception) {
            return false
        }

        val hasGrant = persistedPermissions.any { perm ->
            perm.isReadPermission && perm.uri == uri
        }

        if (!hasGrant) {
            return false
        }

        // Also verify directory access via DocumentFile if possible
        return try {
            val docFile = DocumentFile.fromTreeUri(context, uri)
            docFile != null && docFile.exists() && docFile.canRead()
        } catch (e: Exception) {
            false
        }
    }

    /**
     * True if a valid persisted URI exists with active read permissions.
     */
    fun hasPersistedUriPermission(): Boolean {
        return getPersistedUri() != null
    }

    /**
     * Clear persisted URI permission and local preference without affecting any cached data.
     */
    fun clearPersistedUri() {
        val uriStr = prefs.getString(KEY_PERSISTED_URI, null)
        if (uriStr != null) {
            try {
                val uri = uriParser(uriStr)
                context.contentResolver.releasePersistableUriPermission(
                    uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION
                )
            } catch (e: Exception) {
                // Ignore exception on release
            }
        }
        prefs.edit().remove(KEY_PERSISTED_URI).apply()
    }

    /**
     * Creates an Intent to launch the document tree picker.
     */
    fun createOpenDocumentTreeIntent(): Intent {
        return Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or
                Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
            )
        }
    }
}
