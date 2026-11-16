// make-icon.swift <out.png> — the app icon: a pixel agent at a desk, on the office floor.
import Cocoa
let size = 1024, cell = 64            // a 16×16 pixel-art grid
let img = NSImage(size: NSSize(width: size, height: size))
img.lockFocus()
func px(_ x: Int, _ y: Int, _ w: Int, _ h: Int, _ hex: UInt32) {
    NSColor(red: CGFloat(hex >> 16 & 255) / 255, green: CGFloat(hex >> 8 & 255) / 255, blue: CGFloat(hex & 255) / 255, alpha: 1).setFill()
    NSRect(x: x * cell, y: size - (y + h) * cell, width: w * cell, height: h * cell).fill()
}
let bg = NSBezierPath(roundedRect: NSRect(x: 0, y: 0, width: size, height: size), xRadius: 200, yRadius: 200)
NSColor(red: 0.23, green: 0.20, blue: 0.28, alpha: 1).setFill(); bg.fill()
bg.addClip()
for j in 0..<16 { for i in 0..<16 where (i + j) % 2 == 0 { px(i, j, 1, 1, 0x352f42) } }
px(0, 0, 16, 3, 0x5d5378); px(0, 3, 16, 1, 0x4b4260)          // wall
px(5, 4, 6, 2, 0x2b1d14)                                     // hair
px(5, 6, 6, 3, 0xf1c9a5)                                     // face
px(6, 7, 1, 1, 0x1d1b26); px(9, 7, 1, 1, 0x1d1b26)           // eyes
px(4, 9, 8, 4, 0x5b8def)                                     // shirt
px(3, 11, 1, 1, 0xf1c9a5); px(12, 10, 1, 1, 0xf1c9a5)        // typing hands
px(5, 10, 6, 3, 0x222222); px(6, 10, 4, 2, 0x7fd1b9)         // monitor
px(2, 13, 12, 1, 0x8a6a45); px(3, 14, 1, 2, 0x6d5233); px(12, 14, 1, 2, 0x6d5233)   // desk
px(12, 4, 3, 3, 0xffb347); px(13, 5, 1, 1, 0x1d1b26)         // the "waiting" bubble
img.unlockFocus()
let rep = NSBitmapImageRep(data: img.tiffRepresentation!)!
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
