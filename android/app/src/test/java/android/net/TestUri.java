package android.net;

import android.os.Parcel;
import java.net.URI;
import java.util.Collections;
import java.util.List;

public class TestUri extends Uri {
    private final URI javaUri;
    private final String fullUrl;

    public TestUri(String url) {
        this.fullUrl = url;
        this.javaUri = URI.create(url);
    }

    @Override
    public String getScheme() {
        return javaUri.getScheme();
    }

    @Override
    public String getHost() {
        return javaUri.getHost();
    }

    @Override
    public String getPath() {
        return javaUri.getPath();
    }

    @Override
    public String getEncodedPath() {
        return javaUri.getRawPath();
    }

    @Override
    public String toString() {
        return fullUrl;
    }

    @Override
    public boolean isHierarchical() { return true; }

    @Override
    public boolean isRelative() { return false; }

    @Override
    public String getAuthority() { return javaUri.getAuthority(); }

    @Override
    public String getEncodedAuthority() { return javaUri.getRawAuthority(); }

    @Override
    public String getQuery() { return javaUri.getQuery(); }

    @Override
    public String getEncodedQuery() { return javaUri.getRawQuery(); }

    @Override
    public String getFragment() { return javaUri.getFragment(); }

    @Override
    public String getEncodedFragment() { return javaUri.getRawFragment(); }

    @Override
    public String getSchemeSpecificPart() { return javaUri.getSchemeSpecificPart(); }

    @Override
    public String getEncodedSchemeSpecificPart() { return javaUri.getRawSchemeSpecificPart(); }

    @Override
    public String getUserInfo() { return javaUri.getUserInfo(); }

    @Override
    public String getEncodedUserInfo() { return javaUri.getRawUserInfo(); }

    @Override
    public int getPort() { return javaUri.getPort(); }

    @Override
    public String getLastPathSegment() {
        String path = getPath();
        if (path == null) return null;
        int idx = path.lastIndexOf('/');
        if (idx < 0) return path;
        return path.substring(idx + 1);
    }

    @Override
    public List<String> getPathSegments() {
        String path = getPath();
        if (path == null || path.isEmpty()) return Collections.emptyList();
        String[] parts = path.split("/");
        return java.util.Arrays.asList(parts);
    }

    @Override
    public Builder buildUpon() { return null; }

    @Override
    public int compareTo(Uri o) {
        return fullUrl.compareTo(o != null ? o.toString() : "");
    }

    @Override
    public int describeContents() { return 0; }

    @Override
    public void writeToParcel(Parcel dest, int flags) {}
}
