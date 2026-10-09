#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>
#import <Network/Network.h>
#import <objc/runtime.h>
static const char *fixtureKey = "root-fixture";
@interface RootFixture : NSObject <WKNavigationDelegate, WKScriptMessageHandler>
@property(nonatomic, strong) id<WKNavigationDelegate> original;
@property(nonatomic, weak) WKWebView *web;
@property(nonatomic) BOOL failing;
@property(nonatomic) BOOL injecting;
@end
@implementation RootFixture
- (BOOL)respondsToSelector:(SEL)sel { return [super respondsToSelector:sel] || [self.original respondsToSelector:sel]; }
- (id)forwardingTargetForSelector:(SEL)sel { return [self.original respondsToSelector:sel] ? self.original : [super forwardingTargetForSelector:sel]; }
- (void)paint:(NSURL *)url {
    self.injecting = YES;
    NSString *heading = [url.path isEqualToString:@"/"] || url.path.length == 0 ? @"Healthy production homepage" : @"Wrong app-entry destination";
    NSString *html = [NSString stringWithFormat:@"<!doctype html><meta name='viewport' content='width=device-width,initial-scale=1'><style>body{padding:80px 24px;font-family:system-ui}</style><h1>%@</h1><button onclick=\"window.webkit.messageHandlers.rootFixture.postMessage('fail')\">Fail root reload</button><script>try{Capacitor.Plugins.SplashScreen.hide()}catch(e){}</script>", heading];
    NSURLRequest *request = [NSURLRequest requestWithURL:url];
    NSHTTPURLResponse *response = [[NSHTTPURLResponse alloc] initWithURL:url statusCode:200 HTTPVersion:@"HTTP/1.1" headerFields:@{@"Content-Type":@"text/html", @"Cache-Control":@"max-age=3600"}];
    [self.web loadSimulatedRequest:request response:response responseData:[html dataUsingEncoding:NSUTF8StringEncoding]];
}
- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message {
    if ([message.body isEqual:@"fail"]) { self.failing = YES; [self.web reload]; }
}
- (void)webView:(WKWebView *)web decidePolicyForNavigationAction:(WKNavigationAction *)action decisionHandler:(void (^)(WKNavigationActionPolicy))done {
    if (self.injecting) { self.injecting = NO; done(WKNavigationActionPolicyAllow); return; }
    NSLog(@"ROOT_FIXTURE_REQUEST %@ type=%ld visible=%@", action.request.URL, (long)action.navigationType, web.URL);
    [self.original webView:web decidePolicyForNavigationAction:action decisionHandler:^(WKNavigationActionPolicy policy) {
        NSURL *url = action.request.URL;
        if (policy == WKNavigationActionPolicyAllow && !self.failing && [url.scheme isEqual:@"https"] && [url.host isEqual:@"pubmaxxing.com"]) {
            done(WKNavigationActionPolicyCancel);
            dispatch_async(dispatch_get_main_queue(), ^{ [self paint:url]; });
        } else { done(policy); }
    }];
}
- (void)webView:(WKWebView *)web didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error {
    NSLog(@"ROOT_FIXTURE_REAL_FAILURE %@ %ld %@", error.domain, (long)error.code, error.userInfo[NSURLErrorFailingURLErrorKey]);
    self.failing = NO;
    [self.original webView:web didFailProvisionalNavigation:navigation withError:error];
}
- (void)webView:(WKWebView *)web didFinishNavigation:(WKNavigation *)navigation {
    NSLog(@"ROOT_FIXTURE_FINISHED %@", web.URL);
    if ([self.original respondsToSelector:_cmd]) { [self.original webView:web didFinishNavigation:navigation]; }
}
@end
__attribute__((constructor)) static void setupRootFixture(void) {
    @autoreleasepool {
        nw_endpoint_t endpoint = nw_endpoint_create_host("127.0.0.1", "3490");
        nw_proxy_config_t proxy = nw_proxy_config_create_http_connect(endpoint, NULL);
        WKWebsiteDataStore.defaultDataStore.proxyConfigurations = @[proxy];
        [[NSNotificationCenter defaultCenter] addObserverForName:UIApplicationDidBecomeActiveNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) {
            UIWindowScene *scene = (UIWindowScene *)UIApplication.sharedApplication.connectedScenes.allObjects.firstObject;
            UIView *view = scene.windows.firstObject.rootViewController.view;
            if (![view isKindOfClass:WKWebView.class] || objc_getAssociatedObject(view, fixtureKey)) { return; }
            WKWebView *web = (WKWebView *)view;
            RootFixture *fixture = [RootFixture new];
            fixture.original = web.navigationDelegate;
            fixture.web = web;
            fixture.failing = YES;
            objc_setAssociatedObject(web, fixtureKey, fixture, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
            web.navigationDelegate = fixture;
            [web.configuration.userContentController addScriptMessageHandler:fixture name:@"rootFixture"];
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{ fixture.failing = NO; [fixture paint:[NSURL URLWithString:@"https://pubmaxxing.com/"]]; });
        }];
    }
}
