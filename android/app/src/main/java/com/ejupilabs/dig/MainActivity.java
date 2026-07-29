package com.ejupilabs.dig;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DigGopherPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
