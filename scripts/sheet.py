import sys,glob
from PIL import Image
files=sorted(glob.glob(sys.argv[1]+'/*.png')); cols=int(sys.argv[3]) if len(sys.argv)>3 else 2
ims=[Image.open(f).convert('RGB').resize((960,540)) for f in files]
rows=(len(ims)+cols-1)//cols
sheet=Image.new('RGB',(960*cols,540*rows))
for i,im in enumerate(ims): sheet.paste(im,((i%cols)*960,(i//cols)*540))
sheet.save(sys.argv[2]); print(files)
