// VRKOS's few macOS calls that Electron doesn't offer:
//  - full screen for real: hides the macOS Dock and menu bar and turns off
//    ⌘Tab while VRK is the active app (presentation options),
//  - window levels, so the VRKOS desktop always stays behind every window,
//  - the screen's safe area (the camera notch),
//  - file and app icons as Finder shows them (fast, in-process),
//  - running Mac apps for the VRKOS dock: list, switch to, hide, quit, and
//    hiding the other apps while VRKOS is on.
// Built by scripts/build-native.sh. Uses Node-API, so it loads in any Electron.

#import <AppKit/AppKit.h>
#include <node_api.h>

#define CHECK(call) if ((call) != napi_ok) return NULL

static napi_value make_bool(napi_env env, bool value) {
  napi_value out;
  napi_get_boolean(env, value, &out);
  return out;
}

static napi_value make_string(napi_env env, NSString *value) {
  napi_value out;
  napi_create_string_utf8(env, value ? value.UTF8String : "", NAPI_AUTO_LENGTH, &out);
  return out;
}

static NSWindow *window_from(napi_env env, napi_value buffer) {
  void *data = NULL;
  size_t length = 0;
  if (napi_get_buffer_info(env, buffer, &data, &length) != napi_ok || length < sizeof(void *)) return nil;
  NSView *view = (__bridge NSView *)(*(void **)data);
  return [view isKindOfClass:[NSView class]] ? view.window : nil;
}

static NSString *string_arg(napi_env env, napi_value value) {
  char text[64] = {0};
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, text, sizeof(text), &length) != napi_ok) return @"";
  return [NSString stringWithUTF8String:text];
}

// setFullScreen(on): no Dock, no menu bar, no ⌘Tab or ⌘H while VRK is active.
// Force Quit (⌥⌘⎋) and shutting down stay available.
static napi_value set_full_screen(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  bool on = false;
  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  if (argc > 0) napi_get_value_bool(env, argv[0], &on);
  NSApplicationPresentationOptions options = on
      ? (NSApplicationPresentationHideDock | NSApplicationPresentationHideMenuBar |
         NSApplicationPresentationDisableProcessSwitching | NSApplicationPresentationDisableHideApplication)
      : NSApplicationPresentationDefault;
  @try {
    NSApp.presentationOptions = options;
    return make_bool(env, NSApp.presentationOptions == options);
  } @catch (NSException *e) {
    return make_bool(env, false);
  }
}

// setWindowLevel(handle, 'desktop' | 'normal' | 'overlay')
static napi_value set_window_level(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  if (argc < 2) return make_bool(env, false);
  NSWindow *window = window_from(env, argv[0]);
  if (!window) return make_bool(env, false);
  NSString *level = string_arg(env, argv[1]);
  @try {
    if ([level isEqualToString:@"desktop"]) {
      // Just above Finder's desktop icons, below every app window, in every Space.
      window.level = CGWindowLevelForKey(kCGDesktopIconWindowLevelKey) + 1;
      window.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorStationary |
                                  NSWindowCollectionBehaviorIgnoresCycle;
    } else if ([level isEqualToString:@"overlay"]) {
      window.level = NSPopUpMenuWindowLevel;
    } else {
      window.level = NSNormalWindowLevel;
    }
    return make_bool(env, true);
  } @catch (NSException *e) {
    return make_bool(env, false);
  }
}

// safeAreaTop(handle): height of the camera notch area on this window's screen (0 without one).
static napi_value safe_area_top(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  NSScreen *screen = argc > 0 ? window_from(env, argv[0]).screen : nil;
  if (!screen) screen = NSScreen.mainScreen;
  double top = 0;
  if (@available(macOS 12.0, *)) top = screen.safeAreaInsets.top;
  napi_value out;
  napi_create_double(env, top, &out);
  return out;
}

// runningApps(): the Mac apps with windows (what the Dock would show), not VRK.
static napi_value running_apps(napi_env env, napi_callback_info info) {
  napi_value list;
  CHECK(napi_create_array(env, &list));
  uint32_t index = 0;
  pid_t me = NSProcessInfo.processInfo.processIdentifier;
  for (NSRunningApplication *app in NSWorkspace.sharedWorkspace.runningApplications) {
    if (app.activationPolicy != NSApplicationActivationPolicyRegular || app.processIdentifier == me || app.terminated) continue;
    napi_value item, pid;
    napi_create_object(env, &item);
    napi_create_int32(env, app.processIdentifier, &pid);
    napi_set_named_property(env, item, "pid", pid);
    napi_set_named_property(env, item, "name", make_string(env, app.localizedName));
    napi_set_named_property(env, item, "bundleId", make_string(env, app.bundleIdentifier));
    napi_set_named_property(env, item, "path", make_string(env, app.bundleURL.path));
    napi_set_named_property(env, item, "active", make_bool(env, app.active));
    napi_set_named_property(env, item, "hidden", make_bool(env, app.hidden));
    napi_set_element(env, list, index++, item);
  }
  return list;
}

static NSRunningApplication *app_arg(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  int32_t pid = 0;
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok || argc < 1) return nil;
  if (napi_get_value_int32(env, argv[0], &pid) != napi_ok || pid <= 1) return nil;
  if (pid == NSProcessInfo.processInfo.processIdentifier) return nil;
  return [NSRunningApplication runningApplicationWithProcessIdentifier:pid];
}

static napi_value activate_app(napi_env env, napi_callback_info info) {
  NSRunningApplication *app = app_arg(env, info);
  if (!app) return make_bool(env, false);
  [app unhide];
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  return make_bool(env, [app activateWithOptions:NSApplicationActivateAllWindows]);
#pragma clang diagnostic pop
}

static napi_value hide_app(napi_env env, napi_callback_info info) {
  NSRunningApplication *app = app_arg(env, info);
  return make_bool(env, app && [app hide]);
}

static napi_value quit_app(napi_env env, napi_callback_info info) {
  NSRunningApplication *app = app_arg(env, info);
  return make_bool(env, app && [app terminate]); // asks politely, like Quit in the Dock
}

// fileIcon(path, pixels): the icon Finder shows for a file or app, as PNG.
static napi_value file_icon(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  if (argc < 1) return NULL;
  char path[4096] = {0};
  size_t length = 0;
  if (napi_get_value_string_utf8(env, argv[0], path, sizeof(path), &length) != napi_ok || length == 0) return NULL;
  int32_t pixels = 128;
  if (argc > 1) napi_get_value_int32(env, argv[1], &pixels);
  if (pixels < 16 || pixels > 512) pixels = 128;
  @autoreleasepool {
    NSString *file = [NSString stringWithUTF8String:path];
    NSImage *icon = nil;
    // An app's own icon file first: macOS sometimes answers with a plain folder for an app.
    if ([file.pathExtension.lowercaseString isEqualToString:@"app"]) {
      NSBundle *bundle = [NSBundle bundleWithPath:file];
      NSString *name = [bundle objectForInfoDictionaryKey:@"CFBundleIconFile"];
      if ([name isKindOfClass:[NSString class]] && name.length) {
        NSString *iconPath = [bundle pathForResource:name.stringByDeletingPathExtension ofType:name.pathExtension.length ? name.pathExtension : @"icns"];
        if (iconPath) icon = [[NSImage alloc] initWithContentsOfFile:iconPath];
      }
    }
    if (!icon) icon = [NSWorkspace.sharedWorkspace iconForFile:file];
    if (!icon) return NULL;
    NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL pixelsWide:pixels pixelsHigh:pixels bitsPerSample:8
                                                               samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSDeviceRGBColorSpace
                                                                   bytesPerRow:0 bitsPerPixel:0];
    if (!rep) return NULL;
    rep.size = NSMakeSize(pixels, pixels);
    [NSGraphicsContext saveGraphicsState];
    NSGraphicsContext.currentContext = [NSGraphicsContext graphicsContextWithBitmapImageRep:rep];
    [icon drawInRect:NSMakeRect(0, 0, pixels, pixels) fromRect:NSZeroRect operation:NSCompositingOperationCopy fraction:1.0];
    [NSGraphicsContext restoreGraphicsState];
    NSData *png = [rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
    if (!png) return NULL;
    napi_value out;
    void *copy = NULL;
    if (napi_create_buffer_copy(env, png.length, png.bytes, &copy, &out) != napi_ok) return NULL;
    return out;
  }
}

// hideOtherApps() on entering VRKOS, showAllApps() on leaving: VRKOS is all you see.
static napi_value hide_other_apps(napi_env env, napi_callback_info info) {
  [NSApp hideOtherApplications:nil];
  return make_bool(env, true);
}

static napi_value show_all_apps(napi_env env, napi_callback_info info) {
  [NSApp unhideAllApplications:nil];
  return make_bool(env, true);
}

static napi_value init(napi_env env, napi_value exports) {
  napi_property_descriptor props[] = {
      {"setFullScreen", NULL, set_full_screen, NULL, NULL, NULL, napi_default, NULL},
      {"setWindowLevel", NULL, set_window_level, NULL, NULL, NULL, napi_default, NULL},
      {"safeAreaTop", NULL, safe_area_top, NULL, NULL, NULL, napi_default, NULL},
      {"runningApps", NULL, running_apps, NULL, NULL, NULL, napi_default, NULL},
      {"activateApp", NULL, activate_app, NULL, NULL, NULL, napi_default, NULL},
      {"hideApp", NULL, hide_app, NULL, NULL, NULL, napi_default, NULL},
      {"quitApp", NULL, quit_app, NULL, NULL, NULL, napi_default, NULL},
      {"hideOtherApps", NULL, hide_other_apps, NULL, NULL, NULL, napi_default, NULL},
      {"fileIcon", NULL, file_icon, NULL, NULL, NULL, napi_default, NULL},
      {"showAllApps", NULL, show_all_apps, NULL, NULL, NULL, napi_default, NULL},
  };
  napi_define_properties(env, exports, sizeof(props) / sizeof(props[0]), props);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
