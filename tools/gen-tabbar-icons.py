# 生成 tabBar 图标：81x81 PNG，线条风格，暖木厨房配色。
# 4x 超采样后缩小，得到平滑边缘。
import os
from PIL import Image, ImageDraw

SIZE = 81
SCALE = 4
W = SIZE * SCALE
STROKE = 4 * SCALE

INK = (123, 104, 92, 255)      # #7B685C 未选中
ACTIVE = (201, 102, 59, 255)   # #C9663B 选中

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'miniprogram', 'images', 'TabBar')


def px(v):
    return int(round(v * SCALE))


def dot(draw, x, y, r, color):
    draw.ellipse([x - r, y - r, x + r, y + r], fill=color)


def stroke(draw, points, color):
    """折线 + 两端与拐点补圆，得到圆头线帽的观感"""
    pts = [(px(x), px(y)) for x, y in points]
    draw.line(pts, fill=color, width=STROKE, joint='curve')
    r = STROKE // 2
    for x, y in pts:
        dot(draw, x, y, r, color)


def rounded_rect(draw, box, radius, color):
    x0, y0, x1, y1 = [px(v) for v in box]
    draw.rounded_rectangle([x0, y0, x1, y1], radius=px(radius), outline=color, width=STROKE)


def home(draw, color):
    # 屋顶
    stroke(draw, [(13, 38), (40.5, 15), (68, 38)], color)
    # 屋身两侧 + 底
    stroke(draw, [(20, 36), (20, 64), (61, 64), (61, 36)], color)
    # 门
    stroke(draw, [(33, 64), (33, 48), (48, 48), (48, 64)], color)


def records(draw, color):
    rounded_rect(draw, (17, 13, 64, 68), 8, color)
    stroke(draw, [(28, 30), (53, 30)], color)
    stroke(draw, [(28, 40.5), (53, 40.5)], color)
    stroke(draw, [(28, 51), (44, 51)], color)


def shopping(draw, color):
    # 袋身
    rounded_rect(draw, (15, 32, 66, 68), 9, color)
    # 提手：arc 端点落在袋身顶边（中线 y=32），与袋身自然相接
    draw.arc([px(24), px(14), px(57), px(50)], start=180, end=360, fill=color, width=STROKE)


def mine(draw, color):
    # 头
    draw.ellipse([px(29), px(15), px(52), px(38)], outline=color, width=STROKE)
    # 肩
    draw.arc([px(16), px(44), px(65), px(84)], start=180, end=360, fill=color, width=STROKE)


ICONS = {
    'tab-home': home,
    'tab-records': records,
    'tab-shopping': shopping,
    'tab-mine': mine,
}


def render(fn, color):
    img = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    fn(draw, color)
    return img.resize((SIZE, SIZE), Image.LANCZOS)


def main():
    if not os.path.isdir(OUT):
        os.makedirs(OUT)
    for name, fn in ICONS.items():
        for suffix, color in (('', INK), ('-active', ACTIVE)):
            path = os.path.join(OUT, name + suffix + '.png')
            render(fn, color).save(path, 'PNG', optimize=True)
            print('wrote', os.path.basename(path), os.path.getsize(path), 'bytes')


if __name__ == '__main__':
    main()
