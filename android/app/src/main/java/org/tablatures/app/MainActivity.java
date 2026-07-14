package org.tablatures.app;

import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Draw edge-to-edge so the @capacitor-community/safe-area plugin can
        // deliver correct env(safe-area-inset-*) values to the WebView.
        EdgeToEdge.enable(this);
        super.onCreate(savedInstanceState);
    }
}
