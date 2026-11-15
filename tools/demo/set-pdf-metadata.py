# Marks the demo PDFs as AI-generated in their metadata. Usage: python3 tools/demo/set-pdf-metadata.py app/demo
import sys, glob
from pypdf import PdfReader, PdfWriter
for f in sorted(glob.glob(sys.argv[1] + '/AI-GENERATED_*.pdf')):
    r = PdfReader(f); w = PdfWriter(clone_from=r)
    title = (r.metadata.title or '').replace(' [AI-GENERATED FICTIONAL SAMPLE]', '')
    w.add_metadata({'/Title': title + ' [AI-GENERATED FICTIONAL SAMPLE]', '/Author': 'AI-generated (fictional authors)',
                    '/Subject': 'AI-generated fictional sample for the Meta-Ethnography Canvas demo. Not a real study.',
                    '/Keywords': 'AI-generated; fictional; demo; not for citation', '/Creator': 'Meta-Ethnography Canvas demo generator'})
    with open(f, 'wb') as fh: w.write(fh)
    print('metadata set:', f)
