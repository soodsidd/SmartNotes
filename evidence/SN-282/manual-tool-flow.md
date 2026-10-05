# SN-282 manual Companion tool flow (isolated vault, 2026-10-05T00:21:02.198Z)

## 1. Article page
{
  "path": "Research/Articles/transformer-survey-final.html"
}

## 2. paper_list before create
{
  "papers": [
    {
      "id": "dad36446-6a72-46c4-9d79-309c0b80404b",
      "path": ".bibliography/dad36446-6a72-46c4-9d79-309c0b80404b.html",
      "title": "Attention Is All You Need",
      "referrers": [
        {
          "path": "Research/Articles/attention-survey-ui.html",
          "title": "Attention survey (UI)"
        }
      ]
    }
  ]
}

## 3. paper_create from article
{
  "paper": {
    "id": "da5581fd-c841-49e8-86ad-7cf5a8fe8990",
    "path": ".bibliography/da5581fd-c841-49e8-86ad-7cf5a8fe8990.html",
    "title": "Attention Is All You Need"
  },
  "referencedFrom": "Research/Articles/transformer-survey-final.html"
}

## 4. /api/papers referrers (SN-279 child row source)
[
  {
    "id": "da5581fd-c841-49e8-86ad-7cf5a8fe8990",
    "title": "Attention Is All You Need",
    "referrers": [
      "Research/Articles/transformer-survey-final.html"
    ]
  },
  {
    "id": "dad36446-6a72-46c4-9d79-309c0b80404b",
    "title": "Attention Is All You Need",
    "referrers": [
      "Research/Articles/attention-survey-ui.html"
    ]
  }
]

## 5. paper_attach_pdf (arXiv 1706.03762)
{
  "path": ".bibliography/da5581fd-c841-49e8-86ad-7cf5a8fe8990.html",
  "attachment": {
    "href": "/vault/.bibliography/da5581fd-c841-49e8-86ad-7cf5a8fe8990.assets/1706.03762v7.pdf",
    "path": ".bibliography/da5581fd-c841-49e8-86ad-7cf5a8fe8990.assets/1706.03762v7.pdf",
    "fileName": "1706.03762v7.pdf",
    "bytes": 2215244,
    "sourceUrl": "https://arxiv.org/pdf/1706.03762"
  }
}

## 6. GET attachment href
{
  "status": 200,
  "contentType": "application/pdf",
  "bytes": 2215244
}

## 7. pdf_page_count / pdf_read_page 1
{
  "count": {
    "ok": true,
    "href": ".bibliography/da5581fd-c841-49e8-86ad-7cf5a8fe8990.assets/1706.03762v7.pdf",
    "totalPages": 15
  },
  "page1": "Provided proper attribution is provided, Google hereby grants permission to\nreproduce the tables and figures in this paper solely for use in journalistic or\nscholarly works.\nAttention Is All You Need\nAshish Vaswani∗\nGoogle Brain\navaswani@go"
}

## 8. Paper notes after attach + append
<p><span href="/vault/.bibliography/da5581fd-c841-49e8-86ad-7cf5a8fe8990.assets/1706.03762v7.pdf" filename="1706.03762v7.pdf" data-file-attachment="" data-file-type="pdf" class="file-attachment-chip file-attachment-chip--pdf" contenteditable="false"><span class="file-attachment-icon" aria-hidden="true">PDF</span><span class="file-attachment-name" data-href="/vault/.bibliography/da5581fd-c841-49e8-86ad-7cf5a8fe8990.assets/1706.03762v7.pdf">1706.03762v7.pdf</span></span></p>
<p>Companion summary: self-attention replaces recurrence.</p>

## 9. Companion context — paper open in notes mode
## Open paper (Bibliography)
The owner has this Bibliography paper open. You can read and edit everything in it: notes (page tools on the path below), attached PDFs, and other attachments.
Title: Attention Is All You Need
Path: .bibliography/da5581fd-c841-49e8-86ad-7cf5a8fe8990.html
Paper id: da5581fd-c841-49e8-86ad-7cf5a8fe8990

### Attached PDFs (1)
- 1706.03762v7.pdf — .bibliography/da5581fd-c841-49e8-86ad-7cf5a8fe8990.assets/1706.03762v7.pdf
Use pdf_read_pages / pdf_page_count with these paths to read any attached PDF beyond the context below.

Paper notes: the current page context above is this paper's notes.

## Embedded PDF page context

### 1706.03762v7.pdf
Path: .bibliography/da5581fd-c841-49e8-86ad-7cf5a8fe8990.assets/1706.03762v7.pdf
```text
Provided proper attribution is provided, Google hereby grants permission to
reproduce the tables and figures in this paper solely for use in journalistic or
scholarly works.
Attention Is All You Need
Ashish Vaswani∗
Google Brain
avaswani@google.com
Noam Shazeer∗
Google Brain
noam@google.com
Niki Parmar∗
Google Research
nikip@google.com
Jakob Uszkoreit∗
Google Research
usz@google.com
Llion Jones∗
Google Research
llion@google.com
Aidan N. Gomez∗ †
University of Toronto
aidan@cs.toronto.edu
Łukasz Kaiser∗
Google Brain
lukaszkaiser@google.com
Illia Polosukhin∗ ‡
illia.polosukhin@gmail.com
Abstract
The dominant sequence transduction models are based on complex recurrent or
convolutional neural networks that include an encoder and a decoder. The best
performing models also connect the encoder and decoder through an attention
mechan

## 10. Companion context — PDF shell opened from article chip
## Open paper (Bibliography)
The owner is reading this paper in the paper reading shell: PDF reader with the paper's notes docked beside it.
Title: Attention Is All You Need
Path: .bibliography/da5581fd-c841-49e8-86ad-7cf5a8fe8990.html
Paper id: da5581fd-c841-49e8-86ad-7cf5a8fe8990

### Attached PDFs (1)
- 1706.03762v7.pdf — .bibliography/da5581fd-c841-49e8-86ad-7cf5a8fe8990.assets/1706.03762v7.pdf (open in reader, page 1)
Use pdf_read_pages / pdf_page_count with these paths to read any attached PDF beyond the context below.

### Paper notes
```html
<p><span href="/vault/.bibliography/da5581fd-c841-49e8-86ad-7cf5a8fe8990.assets/1706.03762v7.pdf" filename="1706.03762v7.pdf" data-file-attachment="" data-file-type="pdf" class="file-attachment-chip file-attachment-chip--pdf" contenteditable="false"><span class="file-attachment-icon" aria-hidden="true">PDF</span><span class="file-attachment-name" data-href="/vault/.bibliography/da5581fd-c841-49e8-86ad-7cf5a8fe8990.assets/1706.03762v7.pdf">1706.03762v7.pdf</span></span></p>
<p>Companion summary: self-attention replaces recurrence.</p>
```

## Current PDF page (1)

### 1706.03762v7.pdf
Path: .bibliography/da5581fd-c841-49e8-86ad-7cf5a8fe8990.assets/1706.03762v7.pdf
Reader state: {"href":".bibliography/da5581fd-c841-49e8-86ad-7cf5a8fe8990.assets/1706.03762v7.pdf","fileName":"1706.03762v7.pdf","currentPage":1}
Page count: 15
```text
Provided proper attribution is provided, Google hereby grants permission to
reproduce the tables and figures in this paper solely for use in journalistic or
scholarly works.
Attention Is All You Need
Ash

## 11. paper_remove
{
  "id": "da5581fd-c841-49e8-86ad-7cf5a8fe8990",
  "path": ".bibliography/da5581fd-c841-49e8-86ad-7cf5a8fe8990.html",
  "title": "Attention Is All You Need",
  "clearedReferences": [
    {
      "path": "Research/Articles/transformer-survey-final.html",
      "title": "Transformer survey final"
    }
  ]
}

## 12. Article body after removal
<p>Survey notes citing the transformer paper.</p>


## 13. /api/papers after removal
[
  {
    "page": {
      "id": ".bibliography/dad36446-6a72-46c4-9d79-309c0b80404b.html",
      "path": ".bibliography/dad36446-6a72-46c4-9d79-309c0b80404b.html",
      "slug": "dad36446-6a72-46c4-9d79-309c0b80404b",
      "title": "Attention Is All You Need",
      "preview": "PDF1706.03762v7.pdfCompanion note: encoder-decoder with multi-head self-attention.",
      "content": "<p><span href=\"/vault/.bibliography/dad36446-6a72-46c4-9d79-309c0b80404b.assets/1706.03762v7.pdf\" filename=\"1706.03762v7.pdf\" data-file-attachment=\"\" data-file-type=\"pdf\" class=\"file-attachment-chip file-attachment-chip--pdf\" contenteditable=\"false\"><span class=\"file-attachment-icon\" aria-hidden=\"true\">PDF</span><span class=\"file-attachment-name\" data-href=\"/vault/.bibliography/dad36446-6a72-46c4-9d79-309c0b80404b.assets/1706.03762v7.pdf\">1706.03762v7.pdf</span></span></p><p>Companion note: encoder-decoder with multi-head self-attention.</p>",
      "createdAt": "2026-10-05T00:18:35.231Z",
      "updatedAt": "2026-10-05T00:20:32.178Z",
      "parentId": null,
      "noteType": "text",
      "keyNote": false,
      "metadata": {
        "title": "Attention Is All You Need",
        "paper_id": "dad36446-6a72-46c4-9d79-309c0b80404b",
        "note_type": "text",
        "created": "2026-10-05T00:18:35.231Z",
        "updated": "2026-10-05T00:20:32.178Z"
      }
    },
    "id": "dad36446-6a72-46c4-9d79-309c0b80404b",
    "referrers": [
      {
        "path": "Research/Articles/attention-survey-ui.html",
        "title": "Attention survey (UI)",
        "notebookPath": "Research",
        "notebookName": "Research"
      }
    ]
  }
]

## 14. Attachment after removal
{
  "status": 404
}

## 15. Private-network guard / missing paper
{
  "status": 404,
  "body": {
    "error": "Page not found: .bibliography/0b7a3c1e-4f2d-4a8b-9c3d-2e1f0a9b8c7d.html",
    "code": "PAGE_NOT_FOUND",
    "tool": "paper_attach_pdf"
  }
}
