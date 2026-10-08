#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>

static void LaneFindWebViews(UIView *view, NSMutableArray<WKWebView *> *views) {
    if ([view isKindOfClass:WKWebView.class]) [views addObject:(WKWebView *)view];
    for (UIView *child in view.subviews) LaneFindWebViews(child, views);
}

static NSArray<NSString *> *LaneCookieState(NSArray<NSHTTPCookie *> *cookies) {
    NSMutableArray<NSString *> *state = [NSMutableArray array];
    for (NSHTTPCookie *cookie in cookies) [state addObject:cookie.properties.description];
    return [state sortedArrayUsingSelector:@selector(compare:)];
}

__attribute__((visibility("default"))) void LaneClearLocalHTTPCache(void) {
    dispatch_async(dispatch_get_main_queue(), ^{
        if (![NSBundle.mainBundle.bundleIdentifier isEqualToString:@"com.pubmaxx.app"]) {
            NSLog(@"[lane-typed-cache] ERROR bundle guard"); return;
        }
        NSMutableArray<WKWebView *> *views = [NSMutableArray array];
        for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
            if (![scene isKindOfClass:UIWindowScene.class]) continue;
            for (UIWindow *window in ((UIWindowScene *)scene).windows) {
                LaneFindWebViews(window.rootViewController.view, views);
            }
        }
        if (views.count != 1) { NSLog(@"[lane-typed-cache] ERROR WebView count %lu", (unsigned long)views.count); return; }
        WKWebView *web = views.firstObject;
        NSURL *url = web.URL;
        if (![url.scheme isEqualToString:@"http"] || ![url.host isEqualToString:@"localhost"] || url.port.integerValue != 3491) {
            NSLog(@"[lane-typed-cache] ERROR origin guard"); return;
        }
        WKWebsiteDataStore *store = web.configuration.websiteDataStore;
        NSSet<NSString *> *types = [NSSet setWithObjects:WKWebsiteDataTypeMemoryCache, WKWebsiteDataTypeDiskCache, nil];
        NSDictionary<NSString *, id> *preferences = NSUserDefaults.standardUserDefaults.dictionaryRepresentation;
        NSString *snapshot = @"(async()=>JSON.stringify({url:location.href,history:history.length,state:history.state,local:Object.keys(localStorage).sort().map(k=>[k,localStorage.getItem(k)]),session:Object.keys(sessionStorage).sort().map(k=>[k,sessionStorage.getItem(k)]),controller:navigator.serviceWorker.controller?.scriptURL,registrations:(await navigator.serviceWorker.getRegistrations()).map(x=>x.scope).sort(),caches:(await caches.keys()).sort()}))()";
        [web callAsyncJavaScript:[@"return await " stringByAppendingString:snapshot] arguments:@{} inFrame:nil inContentWorld:WKContentWorld.pageWorld completionHandler:^(id before, NSError *snapshotError) {
            if (snapshotError || ![before isKindOfClass:NSString.class]) { NSLog(@"[lane-typed-cache] ERROR pre-snapshot %@", snapshotError); return; }
            [store.httpCookieStore getAllCookies:^(NSArray<NSHTTPCookie *> *cookies) {
                NSArray<NSString *> *cookieState = LaneCookieState(cookies);
                [store fetchDataRecordsOfTypes:types completionHandler:^(NSArray<WKWebsiteDataRecord *> *records) {
                    NSMutableArray<WKWebsiteDataRecord *> *local = [NSMutableArray array];
                    NSMutableSet<NSString *> *others = [NSMutableSet set];
                    for (WKWebsiteDataRecord *record in records) {
                        if ([record.displayName isEqualToString:@"localhost"]) [local addObject:record];
                        else [others addObject:record.displayName];
                    }
                    if (local.count != 1) { NSLog(@"[lane-typed-cache] ERROR localhost record count %lu", (unsigned long)local.count); return; }
                    NSLog(@"[lane-typed-cache] SELECT localhost records=%lu types=HTTP-memory,HTTP-disk otherRecords=%lu", (unsigned long)local.count, (unsigned long)others.count);
                    [store removeDataOfTypes:types forDataRecords:local completionHandler:^{
                        [store fetchDataRecordsOfTypes:types completionHandler:^(NSArray<WKWebsiteDataRecord *> *remaining) {
                            NSUInteger localRemaining = 0;
                            NSMutableSet<NSString *> *otherRemaining = [NSMutableSet set];
                            for (WKWebsiteDataRecord *record in remaining) {
                                if ([record.displayName isEqualToString:@"localhost"]) localRemaining++;
                                else [otherRemaining addObject:record.displayName];
                            }
                            [store.httpCookieStore getAllCookies:^(NSArray<NSHTTPCookie *> *afterCookies) {
                                [web callAsyncJavaScript:[@"return await " stringByAppendingString:snapshot] arguments:@{} inFrame:nil inContentWorld:WKContentWorld.pageWorld completionHandler:^(id after, NSError *afterError) {
                                    NSLog(@"[lane-typed-cache] COMPLETE localRemaining=%lu othersPreserved=%d cookiesPreserved=%d preferencesPreserved=%d documentStorageHistoryWorkerPreserved=%d error=%@", (unsigned long)localRemaining, [others isSubsetOfSet:otherRemaining], [cookieState isEqualToArray:LaneCookieState(afterCookies)], [preferences isEqualToDictionary:NSUserDefaults.standardUserDefaults.dictionaryRepresentation], !afterError && [before isEqual:after], afterError);
                                }];
                            }];
                        }];
                    }];
                }];
            }];
        }];
    });
}
