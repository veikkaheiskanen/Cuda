// Build a compatible macOS PNG from the supplied Icon Composer document.
import AppKit
let source = NSImage(contentsOfFile: CommandLine.arguments[1])!
var sourceRect = CGRect(origin: .zero, size: source.size)
let image = source.cgImage(forProposedRect: &sourceRect, context: nil, hints: nil)!
let bitmap = NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:1024,pixelsHigh:1024,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0)!
let context=NSGraphicsContext(bitmapImageRep:bitmap)!
NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current=context
let cg=context.cgContext
let background=CGPath(roundedRect:CGRect(x:32,y:32,width:960,height:960),cornerWidth:214,cornerHeight:214,transform:nil)
cg.addPath(background);cg.setFillColor(NSColor(white:0.25,alpha:1).cgColor);cg.fillPath()
let mark=CGRect(x:320,y:304,width:384,height:416)
cg.saveGState();cg.clip(to:mark,mask:image)
let colors=[NSColor(srgbRed:0.20392,green:0.78039,blue:0.34902,alpha:1).cgColor,NSColor(srgbRed:0,green:0.76471,blue:0.81569,alpha:1).cgColor]
let gradient=CGGradient(colorsSpace:CGColorSpaceCreateDeviceRGB(),colors:colors as CFArray,locations:[0,1])!
cg.drawLinearGradient(gradient,start:CGPoint(x:mark.minX,y:mark.maxY),end:CGPoint(x:mark.maxX,y:mark.minY),options:[]);cg.restoreGState()
NSGraphicsContext.restoreGraphicsState()
try! bitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:CommandLine.arguments[2]))
