#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#include <node_api.h>
#include <string.h>
static napi_value apply(napi_env env,napi_callback_info info) {
  size_t argc=2; napi_value args[2], result; void *bytes=NULL; size_t length=0; double radius=24; bool buffer=false;
  napi_get_cb_info(env,info,&argc,args,NULL,NULL);
  if(argc<1 || napi_is_buffer(env,args[0],&buffer)!=napi_ok || !buffer || napi_get_buffer_info(env,args[0],&bytes,&length)!=napi_ok || length!=sizeof(void*)) {napi_throw_type_error(env,NULL,"Expected native NSView handle");return NULL;}
  if(argc>1)napi_get_value_double(env,args[1],&radius);
  void *pointer=NULL;memcpy(&pointer,bytes,sizeof(pointer));NSView *view=(__bridge NSView *)pointer;
  if(![NSThread isMainThread] || !view || !view.window) {napi_get_boolean(env,false,&result);return result;}
  NSWindow *window=view.window;
  NSView *frame=window.contentView.superview;
  // Electron's setBackgroundColor only changes the content layer. AppKit's
  // opaque window background and system bezel otherwise show through outside
  // our larger curve, leaving a bright wedge and a second outline.
  window.opaque=NO;
  window.backgroundColor=NSColor.clearColor;
  // Clip the complete frame, including the native vibrancy backing view.
  [CATransaction begin]; [CATransaction setDisableActions:YES];
  for (NSView *surface in @[frame, window.contentView]) {
    surface.wantsLayer=YES;
    CGFloat curve=fmax(0,fmin(40,radius));
    CAShapeLayer *mask=[CAShapeLayer layer];mask.frame=surface.bounds;
    CGPathRef path=CGPathCreateWithRoundedRect(surface.bounds,curve,curve,NULL);
    mask.path=path;CGPathRelease(path);
    surface.layer.mask=mask;surface.layer.cornerRadius=curve;surface.layer.masksToBounds=YES;
  }
  [CATransaction commit];
  [window invalidateShadow];
  napi_get_boolean(env,true,&result);return result;
}
static void number(napi_env env,napi_value object,const char *key,double value) {
  napi_value result;napi_create_double(env,value,&result);napi_set_named_property(env,object,key,result);
}
// Inspect the live layers rather than relying on the result of an earlier apply.
static napi_value inspect(napi_env env,napi_callback_info info) {
  size_t argc=1,length=0;napi_value argument,result;void *bytes=NULL;bool buffer=false;
  napi_get_cb_info(env,info,&argc,&argument,NULL,NULL);
  if(argc!=1 || napi_is_buffer(env,argument,&buffer)!=napi_ok || !buffer || napi_get_buffer_info(env,argument,&bytes,&length)!=napi_ok || length!=sizeof(void*)) {napi_throw_type_error(env,NULL,"Expected native NSView handle");return NULL;}
  void *pointer=NULL;memcpy(&pointer,bytes,sizeof(pointer));NSView *view=(__bridge NSView *)pointer;
  napi_create_object(env,&result);
  if(![NSThread isMainThread] || !view.window)return result;
  NSWindow *window=view.window;NSView *frame=window.contentView.superview;
  number(env,result,"opaque",window.opaque?1:0);
  number(env,result,"backgroundAlpha",window.backgroundColor.alphaComponent);
  number(env,result,"frameRadius",frame.layer.cornerRadius);
  number(env,result,"contentRadius",window.contentView.layer.cornerRadius);
  number(env,result,"width",frame.bounds.size.width);
  number(env,result,"height",frame.bounds.size.height);
  number(env,result,"maskWidth",frame.layer.mask.bounds.size.width);
  number(env,result,"maskHeight",frame.layer.mask.bounds.size.height);
  NSButton *close=[window standardWindowButton:NSWindowCloseButton];
  if(close) {
    NSRect rect=[close convertRect:close.bounds toView:frame];
    CGFloat top=frame.isFlipped?NSMinY(rect):frame.bounds.size.height-NSMaxY(rect);
    number(env,result,"closeLeft",NSMinX(rect));
    number(env,result,"closeTop",top);
    number(env,result,"controlsBottom",top+rect.size.height);
  }
  return result;
}
static napi_value init(napi_env env,napi_value exports) { napi_value fn;napi_create_function(env,"apply",NAPI_AUTO_LENGTH,apply,NULL,&fn);napi_set_named_property(env,exports,"apply",fn);napi_create_function(env,"inspect",NAPI_AUTO_LENGTH,inspect,NULL,&fn);napi_set_named_property(env,exports,"inspect",fn);return exports; }
NAPI_MODULE(NODE_GYP_MODULE_NAME,init)
