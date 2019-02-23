/**
 * Created by luoway on 2019/2/23
 * 用es6语法重写一遍fastclick
 * 忽略老式浏览器兼容性(Android 4+, iOS 8+)
 */
const deviceIsWindowsPhone = navigator.userAgent.indexOf("Windows Phone") >= 0
const deviceIsAndroid = navigator.userAgent.indexOf('Android') > 0 && !deviceIsWindowsPhone
const deviceIsIOS = /iP(ad|hone|od)/.test(navigator.userAgent) && !deviceIsWindowsPhone;

export class FastClick {
    constructor(layer, options = {}){
        this.trackingClick = false
        this.trackingClickStart = 0

        this.targetElement = null

        this.touchStartX = 0
        this.touchStartY = 0

        this.lastTouchIdentifier = 0

        this.touchBoundary = options.touchBoundary || 10

        this.layer = layer

        this.tapDelay = options.tapDelay || 200
        this.tapTimeout = options.tapTimeout || 700

        if (FastClick.notNeeded(layer)) {
            return;
        }

        // 【译注】addEventListener 事件处理函数中this指向元素节点(layer)，现将以下方法绑定this为构造函数FastClick。
        const methods = ['onMouse', 'onClick', 'onTouchStart', 'onTouchMove', 'onTouchEnd', 'onTouchCancel'];
        methods.forEach(method=>{
            this[method] = this[method].bind(this)
        })

        // 根据需要设置事件处理
        if (deviceIsAndroid) {
            layer.addEventListener('mouseover', this.onMouse, true);
            layer.addEventListener('mousedown', this.onMouse, true);
            layer.addEventListener('mouseup', this.onMouse, true);
        }

        layer.addEventListener('click', this.onClick, true);
        layer.addEventListener('touchstart', this.onTouchStart, false);
        layer.addEventListener('touchmove', this.onTouchMove, false);
        layer.addEventListener('touchend', this.onTouchEnd, false);
        layer.addEventListener('touchcancel', this.onTouchCancel, false);

        //元素上有事件绑定，则将其改为事件监听
        if (typeof layer.onclick === 'function') {
            const oldOnClick = layer.onclick;
            layer.addEventListener('click', function(event) {
                oldOnClick(event);
            }, false);
            layer.onclick = null;
        }
    }

    //触发指定元素的click事件
    sendClick(targetElement, event){
// 有些Android设备上，activeElement 需要失焦，否则合成的click无效 (#24)
        if (document.activeElement && document.activeElement !== targetElement) {
            document.activeElement.blur();
        }

        const touch = event.changedTouches[0];
        const clickEvent = document.createEvent('MouseEvents');
        clickEvent.initMouseEvent(
            this.determineEventType(targetElement),
            true,
            true,
            window,
            1,
            touch.screenX,
            touch.screenY,
            touch.clientX,
            touch.clientY,
            false, false, false, false, 0, null);
        clickEvent.forwardedTouchEvent = true;
        targetElement.dispatchEvent(clickEvent);
    }
    //touchStart时记录位置和滚动距离
    onTouchStart(event){
        //忽略多点触摸
        // 【译注】会造成layer上多点触摸失效
        if (event.targetTouches.length > 1) {
            return true;
        }
        const targetElement = event.target
        const touch = event.targetTouches[0]

        if(deviceIsIOS){
            // iOS上只有受信的事件才会取消选中文本 (issue #49)
            const selection = window.getSelection();
            if (selection.rangeCount && !selection.isCollapsed) {
                return true;
            }

            if (touch.identifier && touch.identifier === this.lastTouchIdentifier) {
                event.preventDefault();
                return false;
            }
            this.lastTouchIdentifier = touch.identifier;

            this.updateScrollParent(targetElement);
        }

        this.trackingClick = true;
        this.trackingClickStart = event.timeStamp;
        this.targetElement = targetElement;

        this.touchStartX = touch.pageX;
        this.touchStartY = touch.pageY;

        //阻止快速双击
        if ((event.timeStamp - this.lastClickTime) < this.tapDelay) {
            event.preventDefault();
        }

        return true;
    }
    // 检查touchmove事件移动距离是否超出设定范围
    touchHasMoved(event){
        const touch = event.changedTouches[0]
        const boundary = this.touchBoundary

        return Math.abs(touch.pageX - this.touchStartX) > boundary ||
            Math.abs(touch.pageY - this.touchStartY) > boundary
    }
    onTouchMove(event){
        if (this.trackingClick) {
            // 触发touchMove时取消click追踪
            if (this.targetElement !== event.target || this.touchHasMoved(event)) {
                this.trackingClick = false;
                this.targetElement = null;
            }
        }

        return true;
    }
    //touchend 决定是否立即触发click事件
    onTouchEnd(event){
        if(!this.trackingClick) return true
        //阻止快速双击
        if ((event.timeStamp - this.lastClickTime) < this.tapDelay) {
            this.cancelNextClick = true;
            return true;
        }
        //触摸时长要够
        if ((event.timeStamp - this.trackingClickStart) > this.tapTimeout) {
            return true;
        }

        this.cancelNextClick = false;

        this.lastClickTime = event.timeStamp;

        const trackingClickStart = this.trackingClickStart;
        this.trackingClick = false;
        this.trackingClickStart = 0;

        let targetElement = this.targetElement
        const targetTagName = targetElement.tagName.toLowerCase()

        if(targetTagName === 'label'){
            const forElement = this.findControl(targetElement)
            if(forElement){
                targetElement.focus()
                if (deviceIsAndroid) {
                    return false;
                }

                targetElement = forElement;
            }
        }else if(this.needsFocus(targetElement)){

            if (
                // touch超过一段时间（猜测100ms）会自动触发focus
                (event.timeStamp - trackingClickStart) > 100 ||
                // 排除 iOS iframe 中的input(issue #37)
                (deviceIsIOS && window.top !== window && targetTagName === 'input')) {
                this.targetElement = null
                return false
            }

            targetElement.focus()
            this.sendClick(targetElement, event)

            if(deviceIsIOS && targetTagName === 'select'){
                // iOS select 需保留默认事件
            }else{
                this.targetElement = null
                event.preventDefault()
            }

            return false
        }

        if (deviceIsIOS) {
            // 滚动容器滚动时，用于停止滚动的触摸，不触发合成click事件 (issue #42).
            const scrollParent = targetElement.fastClickScrollParent;
            if (scrollParent && scrollParent.fastClickLastScrollTop !== scrollParent.scrollTop) {
                return true;
            }
        }

        // 阻止原生click事件
        if (!this.needsClick(targetElement)) {
            event.preventDefault();
            this.sendClick(targetElement, event);
        }

        return false
    }
    onTouchCancel(event){
        this.trackingClick = false;
        this.targetElement = null;
    }
    // 确定鼠标事件是否允许触发click
    onMouse(event){
        // 没有触发touch事件
        if (!this.targetElement) {
            return true;
        }

        if (event.forwardedTouchEvent) {
            return true;
        }

        // 允许程序生成的事件
        if (!event.cancelable) {
            return true;
        }

        if (!this.needsClick(this.targetElement) || this.cancelNextClick) {

            // 阻止用户添加到FastClick元素上的任何事件监听触发
            event.stopImmediatePropagation();

            // 取消事件
            event.stopPropagation();
            event.preventDefault();

            return false;
        }

        return true;
    }

    onClick(event){
        let permitted

        // 可能有非FastClick代码触发click事件
        // 提前return，继续执行onclick事件
        if (this.trackingClick) {
            this.targetElement = null;
            this.trackingClick = false;
            return true;
        }

        // iOS键盘完成，会模拟click submit按钮
        if (event.target.type === 'submit' && event.detail === 0) {
            return true;
        }

        permitted = this.onMouse(event);

        // 不允许时，只需要重置 targetElement
        if (!permitted) {
            this.targetElement = null;
        }

        // 允许click时，返回 true 让 click 继续执行
        return permitted;
    }

    // 销毁事件监听
    destroy(){
        const layer = this.layer;

        if (deviceIsAndroid) {
            layer.removeEventListener('mouseover', this.onMouse, true);
            layer.removeEventListener('mousedown', this.onMouse, true);
            layer.removeEventListener('mouseup', this.onMouse, true);
        }

        layer.removeEventListener('click', this.onClick, true);
        layer.removeEventListener('touchstart', this.onTouchStart, false);
        layer.removeEventListener('touchmove', this.onTouchMove, false);
        layer.removeEventListener('touchend', this.onTouchEnd, false);
        layer.removeEventListener('touchcancel', this.onTouchCancel, false);
    }

    static determineEventType(targetElement){
        //Issue #159: Android Chrome Select Box does not open with a synthetic click event
        if (deviceIsAndroid && targetElement.tagName.toLowerCase() === 'select') {
            return 'mousedown';
        }

        return 'click';
    }
    // 查找label元素管理的节点
    static findControl(labelElement){
        if (labelElement.control !== undefined) {
            return labelElement.control;
        }
        if (labelElement.htmlFor) {
            return document.getElementById(labelElement.htmlFor);
        }
        return labelElement.querySelector('button, input:not([type=hidden]), keygen, meter, output, progress, select, textarea');
    }
    // 检查目标元素是否包含在可滚动图层里，如果目标元素被移动，需要重新检查
    static updateScrollParent(targetElement){
        let scrollParent = targetElement.fastClickScrollParent
        if(scrollParent && scrollParent.contains(targetElement)){

        }else{
            let parentElement = targetElement;
            do {
                if (parentElement.scrollHeight > parentElement.offsetHeight) {
                    scrollParent = parentElement;
                    targetElement.fastClickScrollParent = parentElement;
                    break;
                }

                parentElement = parentElement.parentElement;
            } while (parentElement);
        }

        if (scrollParent) {
            scrollParent.fastClickLastScrollTop = scrollParent.scrollTop;
        }
    }

    // 决定给定元素是否需要原生click
    static needsClick(target){
        switch (target.nodeName.toLowerCase()) {
            case 'button':
            case 'select':
            case 'textarea':
                return target.disabled;
            case 'label':
            case 'iframe': // iOS8 homescreen apps can prevent events bubbling into frames
            case 'video':
                return true;
        }

        return (/\bneedsclick\b/).test(target.className);
    }
    // 决定给定元素是否需要调用focus模拟click
    static needsFocus(target){
        switch (target.nodeName.toLowerCase()) {
            case 'textarea':
                return true;
            case 'select':
                return !deviceIsAndroid;
            case 'input':
                switch (target.type) {
                    case 'button':
                    case 'checkbox':
                    case 'file':
                    case 'image':
                    case 'radio':
                    case 'submit':
                        return false;
                }
                return !target.disabled && !target.readOnly;
            default:
                return (/\bneedsfocus\b/).test(target.className);
        }
    }
    /**
     * 检测是否需要FastClick
     * @param layer
     */
    static notNeeded(layer){
        //不支持touch的设备不需要
        if (typeof window.ontouchstart === 'undefined') {
            return true;
        }
        //取Chrome版本号，其他浏览器置0
        const chromeVersion = +(/Chrome\/([0-9]+)/.exec(navigator.userAgent) || [,0])[1];

        if(chromeVersion){
            if (deviceIsAndroid) {
                const metaViewport = document.querySelector('meta[name=viewport]');

                if (metaViewport) {
                    // Chrome on Android 设置了user-scalable="no"时不需要 (issue #89)
                    if (metaViewport.content.indexOf('user-scalable=no') !== -1) {
                        return true;
                    }
                    // Chrome 32 以上，且不用横向滚动的页面不需要
                    if (chromeVersion > 31 && document.documentElement.scrollWidth <= window.outerWidth) {
                        return true;
                    }
                }
            } else {//桌面版不需要
                return true;
            }
        }

        //处理黑莓系统兼容
        //IE10、11 阻止了双击缩放时不需要

        // 取Chrome版本号，其他浏览器置0
        const firefoxVersion = +(/Firefox\/([0-9]+)/.exec(navigator.userAgent) || [,0])[1];

        if (firefoxVersion >= 27) {
            // 火狐浏览器v27以上，内容不能缩放时，没有触摸延迟

            const metaViewport = document.querySelector('meta[name=viewport]');
            if (metaViewport && (metaViewport.content.indexOf('user-scalable=no') !== -1 || document.documentElement.scrollWidth <= window.outerWidth)) {
                return true;
            }
        }
    }

    static attach(layer, options){
        return new FastClick(layer, options)
    }
}