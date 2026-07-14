package org.tablatures.app;

import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // super.onCreate() must run first so BridgeActivity applies the
        // no-action-bar theme; enabling edge-to-edge before it leaves the
        // system title bar (the black "Tablatures" bar) showing.
        super.onCreate(savedInstanceState);
        EdgeToEdge.enable(this);
    }
}
