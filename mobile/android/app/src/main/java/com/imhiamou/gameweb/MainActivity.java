package com.imhiamou.gameweb;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GamewebUpdatePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
