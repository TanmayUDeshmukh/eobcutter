
 
      let pdfDoc = null;
      let pageSelections = {}; // Store selections for each page
      let pageCanvases = {}; // Store canvas elements for each page
      let isDrawing = false;
      let startPos = { x: 0, y: 0 };
      let currentSelection = null;
      let currentPageNum = null;
      let selectionCounter = 0;

      // Set up PDF.js worker
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

      // File input handling
      const fileInput = document.getElementById("file-input");
      const uploadArea = document.querySelector(".upload-area");
      const loading = document.querySelector(".loading");
      const pdfViewer = document.querySelector(".pdf-viewer");
      const pagesGrid = document.getElementById("pages-grid");

      fileInput.addEventListener("change", handleFile);

      // Modal handling
      const exportModal = document.getElementById("export-modal");

      // Drag and drop functionality
      uploadArea.addEventListener("dragover", (e) => {
        e.preventDefault();
        uploadArea.classList.add("dragover");
      });

      uploadArea.addEventListener("dragleave", () => {
        uploadArea.classList.remove("dragover");
      });

      uploadArea.addEventListener("drop", (e) => {
        e.preventDefault();
        uploadArea.classList.remove("dragover");
        const files = e.dataTransfer.files;
        if (files.length > 0 && files[0].type === "application/pdf") {
          handleFile({ target: { files } });
        }
      });

      async function handleFile(event) {
        const file = event.target.files[0];
        if (!file || file.type !== "application/pdf") {
          showError("Please select a valid PDF file.");
          return;
        }

        if (file.size > 50 * 1024 * 1024) {
          showError("File size must be less than 50MB.");
          return;
        }

        loading.classList.add("show");
        document.getElementById("loading-text").textContent = "Loading PDF...";
        uploadArea.style.display = "none";
        pdfViewer.style.display = "none";
        pageSelections = {};
        pageCanvases = {};
        selectionCounter = 0;

        try {
          const arrayBuffer = await file.arrayBuffer();
          pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
          await renderPages();

          loading.classList.remove("show");
          pdfViewer.style.display = "block";
          updateSelectedCount();
        } catch (error) {
          console.error("Error loading PDF:", error);
          showError(
            "Error loading PDF. Please try again with a different file."
          );
          loading.classList.remove("show");
          uploadArea.style.display = "block";
        }
      }

      async function renderPages() {
        pagesGrid.innerHTML = "";
        const progressBar = document.querySelector(".progress-bar");
        const progressFill = document.getElementById("progress-fill");
        progressBar.style.display = "block";

        for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
          document.getElementById(
            "loading-text"
          ).textContent = `Rendering page ${pageNum} of ${pdfDoc.numPages}...`;
          const progress = (pageNum / pdfDoc.numPages) * 100;
          progressFill.style.width = `${progress}%`;

          const page = await pdfDoc.getPage(pageNum);
          const scale = 1.5; // Higher resolution for better quality
          const viewport = page.getViewport({ scale });

          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.className = "page-canvas";
          canvas.dataset.pageNum = pageNum;

          await page.render({
            canvasContext: context,
            viewport: viewport,
          }).promise;

          // Store canvas for later use
          pageCanvases[pageNum] = {
            canvas: canvas,
            context: context,
            viewport: viewport,
          };

          // Create page container
          const pageContainer = document.createElement("div");
          pageContainer.className = "page-container";

          // Page header
          const pageHeader = document.createElement("div");
          pageHeader.className = "page-header";

          const pageNumber = document.createElement("div");
          pageNumber.className = "page-number";
          pageNumber.textContent = `Page ${pageNum}`;

          const selectionCount = document.createElement("div");
          selectionCount.className = "selection-count";
          selectionCount.textContent = "0 sections";
          selectionCount.id = `count-${pageNum}`;

          pageHeader.appendChild(pageNumber);
          pageHeader.appendChild(selectionCount);

          // Page wrapper with overlay
          const pageWrapper = document.createElement("div");
          pageWrapper.className = "page-wrapper";
          pageWrapper.style.position = "relative";

          const overlay = document.createElement("div");
          overlay.className = "selection-overlay";
          overlay.dataset.pageNum = pageNum;

          pageWrapper.appendChild(canvas);
          pageWrapper.appendChild(overlay);

          // Page controls
          const pageControls = document.createElement("div");
          pageControls.className = "page-controls";

          const clearBtn = document.createElement("button");
          clearBtn.className = "btn btn-secondary btn-small";
          clearBtn.textContent = "Clear Page";
          clearBtn.onclick = () => clearPageSelections(pageNum);

          pageControls.appendChild(clearBtn);

          pageContainer.appendChild(pageHeader);
          pageContainer.appendChild(pageWrapper);
          pageContainer.appendChild(pageControls);
          pagesGrid.appendChild(pageContainer);

          // Initialize selections for this page
          pageSelections[pageNum] = [];

          // Add event listeners for drawing
          setupDrawingEvents(canvas, overlay, pageNum);

          // Small delay to prevent UI blocking
          await new Promise((resolve) => setTimeout(resolve, 10));
        }

        progressBar.style.display = "none";
      }

      function setupDrawingEvents(canvas, overlay, pageNum) {
        let isDrawingOnPage = false;
        let startPosPage = { x: 0, y: 0 };
        let currentRect = null;

        // Mouse events
        canvas.addEventListener("mousedown", (e) => {
          e.preventDefault();
          startDrawing(e, overlay, pageNum);
        });

        overlay.addEventListener("mousemove", (e) => {
          if (isDrawing && currentPageNum === pageNum) {
            drawSelection(e, overlay, pageNum);
          }
        });

        // Listen to mousemove and mouseup on document to handle mouse leaving canvas area
        document.addEventListener("mousemove", (e) => {
          if (isDrawing && currentPageNum === pageNum) {
            const overlayRect = overlay.getBoundingClientRect();
            const relativeX = e.clientX - overlayRect.left;
            const relativeY = e.clientY - overlayRect.top;

            // Clamp coordinates to overlay bounds
            const clampedX = Math.max(
              0,
              Math.min(relativeX, overlayRect.width)
            );
            const clampedY = Math.max(
              0,
              Math.min(relativeY, overlayRect.height)
            );

            updateSelectionRect(clampedX, clampedY, overlay, pageNum);
          }
        });

        document.addEventListener("mouseup", (e) => {
          if (isDrawing && currentPageNum === pageNum) {
            endDrawing(e, overlay, pageNum);
          }
        });

        // Touch events for mobile
        canvas.addEventListener("touchstart", (e) => {
          e.preventDefault();
          const touch = e.touches[0];
          const rect = canvas.getBoundingClientRect();
          const mouseEvent = {
            preventDefault: () => {},
            clientX: touch.clientX,
            clientY: touch.clientY,
            target: canvas,
          };
          startDrawing(mouseEvent, overlay, pageNum);
        });

        overlay.addEventListener("touchmove", (e) => {
          e.preventDefault();
          if (isDrawing && currentPageNum === pageNum) {
            const touch = e.touches[0];
            const overlayRect = overlay.getBoundingClientRect();
            const relativeX = touch.clientX - overlayRect.left;
            const relativeY = touch.clientY - overlayRect.top;
            updateSelectionRect(relativeX, relativeY, overlay, pageNum);
          }
        });

        document.addEventListener("touchend", (e) => {
          if (isDrawing && currentPageNum === pageNum) {
            e.preventDefault();
            endDrawing({ target: overlay }, overlay, pageNum);
          }
        });
      }

      function startDrawing(e, overlay, pageNum) {
        // Don't start drawing if clicking on an existing selection
        if (
          e.target.classList.contains("selection-rect") ||
          e.target.classList.contains("delete-btn")
        ) {
          return;
        }

        isDrawing = true;
        currentPageNum = pageNum;

        const overlayRect = overlay.getBoundingClientRect();
        startPos = {
          x: e.clientX - overlayRect.left,
          y: e.clientY - overlayRect.top,
        };

        // Clamp start position to overlay bounds
        startPos.x = Math.max(0, Math.min(startPos.x, overlayRect.width));
        startPos.y = Math.max(0, Math.min(startPos.y, overlayRect.height));

        currentSelection = document.createElement("div");
        currentSelection.className = "selection-rect";
        currentSelection.style.left = startPos.x + "px";
        currentSelection.style.top = startPos.y + "px";
        currentSelection.style.width = "0px";
        currentSelection.style.height = "0px";
        currentSelection.dataset.selectionId = `selection-${++selectionCounter}`;

        // Create delete button
        const deleteBtn = document.createElement("button");
        deleteBtn.className = "delete-btn";
        deleteBtn.innerHTML = "×";
        currentSelection.appendChild(deleteBtn);

        overlay.appendChild(currentSelection);
      }

      function updateSelectionRect(currentX, currentY, overlay, pageNum) {
        if (!currentSelection) return;

        const width = Math.abs(currentX - startPos.x);
        const height = Math.abs(currentY - startPos.y);
        const left = Math.min(currentX, startPos.x);
        const top = Math.min(currentY, startPos.y);

        // Ensure selection stays within overlay bounds
        const overlayRect = overlay.getBoundingClientRect();
        const maxLeft = Math.min(left, overlayRect.width - 5);
        const maxTop = Math.min(top, overlayRect.height - 5);
        const maxWidth = Math.min(width, overlayRect.width - maxLeft);
        const maxHeight = Math.min(height, overlayRect.height - maxTop);

        currentSelection.style.left = Math.max(0, maxLeft) + "px";
        currentSelection.style.top = Math.max(0, maxTop) + "px";
        currentSelection.style.width = Math.max(0, maxWidth) + "px";
        currentSelection.style.height = Math.max(0, maxHeight) + "px";
      }

      function drawSelection(e, overlay, pageNum) {
        if (!isDrawing || currentPageNum !== pageNum) return;

        const overlayRect = overlay.getBoundingClientRect();
        const currentX = e.clientX - overlayRect.left;
        const currentY = e.clientY - overlayRect.top;

        updateSelectionRect(currentX, currentY, overlay, pageNum);
      }

      function endDrawing(e, overlay, pageNum) {
        if (!isDrawing || currentPageNum !== pageNum) return;

        isDrawing = false;

        if (!currentSelection) return;

        const width = parseInt(currentSelection.style.width);
        const height = parseInt(currentSelection.style.height);

        // Remove selection if too small
        if (width < 5 || height < 5) {
          currentSelection.remove();
          currentSelection = null;
          return;
        }

        // Store selection data
        const selection = {
          left: parseInt(currentSelection.style.left),
          top: parseInt(currentSelection.style.top),
          width: width,
          height: height,
          element: currentSelection,
          id: currentSelection.dataset.selectionId,
        };

        pageSelections[pageNum].push(selection);

        // Add delete functionality to the button
        const deleteBtn = currentSelection.querySelector(".delete-btn");
        deleteBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          removeSelection(pageNum, selection);
        });

        // Prevent the selection itself from starting a new drawing operation
        currentSelection.addEventListener("mousedown", (e) => {
          e.stopPropagation();
        });

        updatePageCount(pageNum);
        updateSelectedCount();
        currentSelection = null;
        currentPageNum = null;
      }

      function removeSelection(pageNum, selection) {
        const index = pageSelections[pageNum].indexOf(selection);
        if (index > -1) {
          pageSelections[pageNum].splice(index, 1);
          if (selection.element && selection.element.parentNode) {
            selection.element.parentNode.removeChild(selection.element);
          }
          updatePageCount(pageNum);
          updateSelectedCount();
        }
      }

      function clearPageSelections(pageNum) {
        pageSelections[pageNum].forEach((selection) => {
          if (selection.element && selection.element.parentNode) {
            selection.element.parentNode.removeChild(selection.element);
          }
        });
        pageSelections[pageNum] = [];
        updatePageCount(pageNum);
        updateSelectedCount();
      }

      function clearAllSelections() {
        Object.keys(pageSelections).forEach((pageNum) => {
          clearPageSelections(pageNum);
        });
      }

      function updatePageCount(pageNum) {
        const countElement = document.getElementById(`count-${pageNum}`);
        if (countElement) {
          const count = pageSelections[pageNum].length;
          countElement.textContent = `${count} section${
            count !== 1 ? "s" : ""
          }`;
        }
      }

      function updateSelectedCount() {
        const totalSelections = Object.values(pageSelections).reduce(
          (total, selections) => total + selections.length,
          0
        );

        const selectedCount = document.querySelector(".selected-count");
        const extractBtn = document.getElementById("extract-btn");

        if (selectedCount) {
          selectedCount.textContent = `Selected: ${totalSelections} section${
            totalSelections !== 1 ? "s" : ""
          }`;
        }
        if (extractBtn) {
          extractBtn.disabled = totalSelections === 0;
        }
      }

      function showExportModal() {
        const totalSelections = Object.values(pageSelections).reduce(
          (total, selections) => total + selections.length,
          0
        );

        if (totalSelections === 0) return;

        // Set default filename with timestamp
        const timestamp = new Date()
          .toISOString()
          .replace(/[:.]/g, "-")
          .slice(0, -5)
          .replace("T", "_");

        const filenameInput = document.getElementById("filename");
        if (filenameInput.value === "extracted_sections") {
          filenameInput.value = `extracted_sections_${timestamp}`;
        }

        exportModal.classList.add("show");
      }

      function closeExportModal() {
        exportModal.classList.remove("show");
      }

      function startExtraction() {
        const filename =
          document.getElementById("filename").value.trim() ||
          "extracted_sections";

        closeExportModal();
        extractSections(filename);
      }

      // Close modal when clicking outside
      exportModal.addEventListener("click", (e) => {
        if (e.target === exportModal) {
          closeExportModal();
        }
      });

      async function extractSections(filename) {
        const totalSelections = Object.values(pageSelections).reduce(
          (total, selections) => total + selections.length,
          0
        );

        if (totalSelections === 0) return;

        loading.classList.add("show");
        document.getElementById("loading-text").textContent =
          "Extracting sections...";
        const progressBar = document.querySelector(".progress-bar");
        const progressFill = document.getElementById("progress-fill");
        progressBar.style.display = "block";

        try {
          const { jsPDF } = window.jspdf;
          const pdf = new jsPDF();
          let processedSections = 0;

          // Collect all sections from all pages and sort them by page number
          const allSections = [];
          for (const [pageNumStr, selections] of Object.entries(
            pageSelections
          )) {
            if (selections.length === 0) continue;
            const pageNum = parseInt(pageNumStr);
            selections.forEach((selection, selectionIndex) => {
              allSections.push({
                pageNum: pageNum,
                selection: selection,
                selectionIndex: selectionIndex,
              });
            });
          }

          // Sort sections by page number, then by selection order
          allSections.sort((a, b) => {
            if (a.pageNum !== b.pageNum) {
              return a.pageNum - b.pageNum;
            }
            return a.selectionIndex - b.selectionIndex;
          });

          console.log(`Total sections to process: ${allSections.length}`);

          // Process sections with auto layout
          await processAutoLayout(pdf, allSections, progressFill, () => {
            processedSections++;
            const progress = (processedSections / totalSelections) * 100;
            progressFill.style.width = `${progress}%`;
            document.getElementById(
              "loading-text"
            ).textContent = `Extracting section ${processedSections} of ${totalSelections}...`;
          });

          // Save the PDF
          pdf.save(`${filename}.pdf`);

          loading.classList.remove("show");
          progressBar.style.display = "none";
          showSuccess();

          console.log(
            `Successfully created PDF with ${totalSelections} sections`
          );
        } catch (error) {
          console.error("Error extracting sections:", error);
          showError("Error extracting sections. Please try again.");
          loading.classList.remove("show");
          progressBar.style.display = "none";
        }
      }

      // Replace the processAutoLayout function with this version:
      async function processAutoLayout(
        pdf,
        allSections,
        progressFill,
        updateProgress
      ) {
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const margin = 15;
        const availableWidth = pageWidth - margin * 2;
        const availableHeight = pageHeight - margin * 2;
        const sectionSpacing = 20; // Space between sections

        let sectionsAdded = 0;
        let currentYPosition = margin;

        for (let i = 0; i < allSections.length; i++) {
          const { pageNum, selection } = allSections[i];
          updateProgress();

          const imageData = await extractSectionImage(pageNum, selection);
          if (!imageData) continue;

          // Calculate section dimensions maintaining aspect ratio
          const aspectRatio = selection.width / selection.height;
          let sectionWidth = Math.min(availableWidth, selection.width);
          let sectionHeight = sectionWidth / aspectRatio;

          // If section is too tall, scale down
          if (sectionHeight > availableHeight * 0.8) {
            // Max 80% of page height per section
            sectionHeight = availableHeight * 0.8;
            sectionWidth = sectionHeight * aspectRatio;
          }

          // Check if we need a new page
          if (currentYPosition + sectionHeight > pageHeight - margin) {
            if (sectionsAdded > 0) {
              pdf.addPage();
              currentYPosition = margin;
            }
          }

          // Center the section horizontally
          const sectionX = margin + (availableWidth - sectionWidth) / 2;

          // Add the section to PDF
          await addImageToPDF(
            pdf,
            imageData,
            sectionX,
            currentYPosition,
            sectionWidth,
            sectionHeight
          );

          sectionsAdded++;
          currentYPosition += sectionHeight + sectionSpacing;

          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }

      // Remove or comment out these functions as they're no longer needed:
      // - arrangeFourSections
      // - arrangeThreeSections
      // - arrangeTwoSections
      // - arrangeSingleSection
      // - getOptimalArrangement
      // - tryHorizontalArrangement
      // - tryVerticalArrangement
      // - tryTwoPlusOneArrangement
      // - tryOnePlusTwoArrangement
      // - canFitSectionOnPage
      // - shouldFinalizePage
      // - calculatePageUtilization
      // - arrangeAutoLayout
      // - arrangeFallbackGrid

      // Keep the extractSectionImage and addImageToPDF functions as they are - no changes needed
      function canFitSectionOnPage(
        currentSections,
        newSection,
        availableWidth,
        availableHeight
      ) {
        if (currentSections.length === 0) return true;
        if (currentSections.length >= 4) return false; // Max 4 sections per page

        // Test different layout arrangements to see if the new section fits
        const testSections = [...currentSections, newSection];
        const arrangements = getOptimalArrangement(
          testSections,
          availableWidth,
          availableHeight
        );

        return arrangements.fits;
      }

      function shouldFinalizePage(
        currentSections,
        remainingSections,
        availableWidth,
        availableHeight
      ) {
        if (currentSections.length === 0) return false;
        if (currentSections.length >= 3) return true; // Good page utilization
        if (remainingSections.length === 0) return true; // No more sections

        // Check if adding the next section would significantly worsen the layout
        if (remainingSections.length > 0 && currentSections.length >= 2) {
          const nextSection = {
            aspectRatio:
              remainingSections[0].selection.width /
              remainingSections[0].selection.height,
            area:
              remainingSections[0].selection.width *
              remainingSections[0].selection.height,
          };

          const currentUtilization = calculatePageUtilization(
            currentSections,
            availableWidth,
            availableHeight
          );
          const withNextUtilization = calculatePageUtilization(
            [...currentSections, nextSection],
            availableWidth,
            availableHeight
          );

          // If adding the next section would reduce utilization significantly, finalize current page
          return withNextUtilization < currentUtilization * 0.8;
        }

        return false;
      }

      function calculatePageUtilization(
        sections,
        availableWidth,
        availableHeight
      ) {
        const arrangement = getOptimalArrangement(
          sections,
          availableWidth,
          availableHeight
        );
        if (!arrangement.fits) return 0;

        const totalSectionArea = arrangement.sections.reduce(
          (sum, s) => sum + s.width * s.height,
          0
        );
        const pageArea = availableWidth * availableHeight;
        return totalSectionArea / pageArea;
      }

      function getOptimalArrangement(
        sections,
        availableWidth,
        availableHeight
      ) {
        if (sections.length === 1) {
          return arrangeSingleSection(
            sections[0],
            availableWidth,
            availableHeight
          );
        } else if (sections.length === 2) {
          return arrangeTwoSections(sections, availableWidth, availableHeight);
        } else if (sections.length === 3) {
          return arrangeThreeSections(
            sections,
            availableWidth,
            availableHeight
          );
        } else if (sections.length === 4) {
          return arrangeFourSections(sections, availableWidth, availableHeight);
        }

        return { fits: false, sections: [] };
      }

      function arrangeSingleSection(section, availableWidth, availableHeight) {
        let width = availableWidth;
        let height = width / section.aspectRatio;

        if (height > availableHeight) {
          height = availableHeight;
          width = height * section.aspectRatio;
        }

        return {
          fits: true,
          sections: [
            {
              ...section,
              width,
              height,
              x: (availableWidth - width) / 2,
              y: (availableHeight - height) / 2,
            },
          ],
        };
      }

      function tryHorizontalArrangement(
        sections,
        availableWidth,
        availableHeight
      ) {
        const spacing = 10;
        const sectionWidth = (availableWidth - spacing) / 2;

        const arrangedSections = [];
        let maxHeight = 0;

        for (let i = 0; i < 2; i++) {
          const section = sections[i];
          let width = sectionWidth;
          let height = width / section.aspectRatio;

          if (height > availableHeight) {
            height = availableHeight;
            width = height * section.aspectRatio;

            if (width > sectionWidth) {
              return { fits: false, sections: [] };
            }
          }

          maxHeight = Math.max(maxHeight, height);

          arrangedSections.push({
            ...section,
            width,
            height,
            x: i * (sectionWidth + spacing) + (sectionWidth - width) / 2,
            y: 0,
          });
        }

        // Center vertically
        arrangedSections.forEach((s) => {
          s.y = (availableHeight - maxHeight) / 2;
        });

        return { fits: true, sections: arrangedSections };
      }

      function tryVerticalArrangement(
        sections,
        availableWidth,
        availableHeight
      ) {
        const spacing = 10;
        const sectionHeight = (availableHeight - spacing) / 2;

        const arrangedSections = [];
        let maxWidth = 0;

        for (let i = 0; i < 2; i++) {
          const section = sections[i];
          let height = sectionHeight;
          let width = height * section.aspectRatio;

          if (width > availableWidth) {
            width = availableWidth;
            height = width / section.aspectRatio;

            if (height > sectionHeight) {
              return { fits: false, sections: [] };
            }
          }

          maxWidth = Math.max(maxWidth, width);

          arrangedSections.push({
            ...section,
            width,
            height,
            x: 0,
            y: i * (sectionHeight + spacing) + (sectionHeight - height) / 2,
          });
        }

        // Center horizontally
        arrangedSections.forEach((s) => {
          s.x = (availableWidth - maxWidth) / 2;
        });

        return { fits: true, sections: arrangedSections };
      }

      function tryTwoPlusOneArrangement(
        sections,
        availableWidth,
        availableHeight,
        horizontal
      ) {
        const spacing = 10;

        if (horizontal) {
          // 2 sections on top, 1 on bottom
          const topHeight = (availableHeight - spacing) * 0.6;
          const bottomHeight = (availableHeight - spacing) * 0.4;
          const topSectionWidth = (availableWidth - spacing) / 2;

          const arrangedSections = [];

          // Top two sections
          for (let i = 0; i < 2; i++) {
            const section = sections[i];
            let width = topSectionWidth;
            let height = width / section.aspectRatio;

            if (height > topHeight) {
              height = topHeight;
              width = height * section.aspectRatio;

              if (width > topSectionWidth) {
                return { fits: false, sections: [] };
              }
            }

            arrangedSections.push({
              ...section,
              width,
              height,
              x:
                i * (topSectionWidth + spacing) + (topSectionWidth - width) / 2,
              y: (topHeight - height) / 2,
            });
          }

          // Bottom section
          const bottomSection = sections[2];
          let bottomWidth = availableWidth;
          let bottomSectionHeight = bottomWidth / bottomSection.aspectRatio;

          if (bottomSectionHeight > bottomHeight) {
            bottomSectionHeight = bottomHeight;
            bottomWidth = bottomSectionHeight * bottomSection.aspectRatio;

            if (bottomWidth > availableWidth) {
              return { fits: false, sections: [] };
            }
          }

          arrangedSections.push({
            ...bottomSection,
            width: bottomWidth,
            height: bottomSectionHeight,
            x: (availableWidth - bottomWidth) / 2,
            y: topHeight + spacing + (bottomHeight - bottomSectionHeight) / 2,
          });

          return { fits: true, sections: arrangedSections };
        } else {
          // 2 sections on left, 1 on right
          const leftWidth = (availableWidth - spacing) * 0.6;
          const rightWidth = (availableWidth - spacing) * 0.4;
          const leftSectionHeight = (availableHeight - spacing) / 2;

          const arrangedSections = [];

          // Left two sections
          for (let i = 0; i < 2; i++) {
            const section = sections[i];
            let height = leftSectionHeight;
            let width = height * section.aspectRatio;

            if (width > leftWidth) {
              width = leftWidth;
              height = width / section.aspectRatio;

              if (height > leftSectionHeight) {
                return { fits: false, sections: [] };
              }
            }

            arrangedSections.push({
              ...section,
              width,
              height,
              x: (leftWidth - width) / 2,
              y:
                i * (leftSectionHeight + spacing) +
                (leftSectionHeight - height) / 2,
            });
          }

          // Right section
          const rightSection = sections[2];
          let rightHeight = availableHeight;
          let rightSectionWidth = rightHeight * rightSection.aspectRatio;

          if (rightSectionWidth > rightWidth) {
            rightSectionWidth = rightWidth;
            rightHeight = rightSectionWidth / rightSection.aspectRatio;

            if (rightHeight > availableHeight) {
              return { fits: false, sections: [] };
            }
          }

          arrangedSections.push({
            ...rightSection,
            width: rightSectionWidth,
            height: rightHeight,
            x: leftWidth + spacing + (rightWidth - rightSectionWidth) / 2,
            y: (availableHeight - rightHeight) / 2,
          });

          return { fits: true, sections: arrangedSections };
        }
      }

      function tryOnePlusTwoArrangement(
        sections,
        availableWidth,
        availableHeight,
        horizontal
      ) {
        const spacing = 10;

        if (horizontal) {
          // 1 section on top, 2 on bottom
          const topHeight = (availableHeight - spacing) * 0.4;
          const bottomHeight = (availableHeight - spacing) * 0.6;
          const bottomSectionWidth = (availableWidth - spacing) / 2;

          const arrangedSections = [];

          // Top section
          const topSection = sections[0];
          let topWidth = availableWidth;
          let topSectionHeight = topWidth / topSection.aspectRatio;

          if (topSectionHeight > topHeight) {
            topSectionHeight = topHeight;
            topWidth = topSectionHeight * topSection.aspectRatio;

            if (topWidth > availableWidth) {
              return { fits: false, sections: [] };
            }
          }

          arrangedSections.push({
            ...topSection,
            width: topWidth,
            height: topSectionHeight,
            x: (availableWidth - topWidth) / 2,
            y: (topHeight - topSectionHeight) / 2,
          });

          // Bottom two sections
          for (let i = 1; i < 3; i++) {
            const section = sections[i];
            let width = bottomSectionWidth;
            let height = width / section.aspectRatio;

            if (height > bottomHeight) {
              height = bottomHeight;
              width = height * section.aspectRatio;

              if (width > bottomSectionWidth) {
                return { fits: false, sections: [] };
              }
            }

            arrangedSections.push({
              ...section,
              width,
              height,
              x:
                (i - 1) * (bottomSectionWidth + spacing) +
                (bottomSectionWidth - width) / 2,
              y: topHeight + spacing + (bottomHeight - height) / 2,
            });
          }

          return { fits: true, sections: arrangedSections };
        } else {
          // 1 section on left, 2 on right
          const leftWidth = (availableWidth - spacing) * 0.4;
          const rightWidth = (availableWidth - spacing) * 0.6;
          const rightSectionHeight = (availableHeight - spacing) / 2;

          const arrangedSections = [];

          // Left section
          const leftSection = sections[0];
          let leftHeight = availableHeight;
          let leftSectionWidth = leftHeight * leftSection.aspectRatio;

          if (leftSectionWidth > leftWidth) {
            leftSectionWidth = leftWidth;
            leftHeight = leftSectionWidth / leftSection.aspectRatio;

            if (leftHeight > availableHeight) {
              return { fits: false, sections: [] };
            }
          }

          arrangedSections.push({
            ...leftSection,
            width: leftSectionWidth,
            height: leftHeight,
            x: (leftWidth - leftSectionWidth) / 2,
            y: (availableHeight - leftHeight) / 2,
          });

          // Right two sections
          for (let i = 1; i < 3; i++) {
            const section = sections[i];
            let height = rightSectionHeight;
            let width = height * section.aspectRatio;

            if (width > rightWidth) {
              width = rightWidth;
              height = width / section.aspectRatio;

              if (height > rightSectionHeight) {
                return { fits: false, sections: [] };
              }
            }

            arrangedSections.push({
              ...section,
              width,
              height,
              x: leftWidth + spacing + (rightWidth - width) / 2,
              y:
                (i - 1) * (rightSectionHeight + spacing) +
                (rightSectionHeight - height) / 2,
            });
          }

          return { fits: true, sections: arrangedSections };
        }
      }

      async function arrangeAutoLayout(
        pdf,
        sections,
        availableWidth,
        availableHeight,
        margin
      ) {
        if (sections.length === 0) return;

        const arrangement = getOptimalArrangement(
          sections,
          availableWidth,
          availableHeight
        );
        if (!arrangement.fits) {
          console.warn(
            `Could not fit ${sections.length} sections on page, using fallback arrangement`
          );
          // Fallback: arrange in grid regardless of optimal fit
          await arrangeFallbackGrid(
            pdf,
            sections,
            availableWidth,
            availableHeight,
            margin
          );
          return;
        }

        for (const section of arrangement.sections) {
          await addImageToPDF(
            pdf,
            section.imageData,
            margin + section.x,
            margin + section.y,
            section.width,
            section.height
          );
        }
      }

      async function arrangeFallbackGrid(
        pdf,
        sections,
        availableWidth,
        availableHeight,
        margin
      ) {
        const cols = Math.ceil(Math.sqrt(sections.length));
        const rows = Math.ceil(sections.length / cols);
        const spacing = 10;

        const sectionWidth = (availableWidth - (cols - 1) * spacing) / cols;
        const sectionHeight = (availableHeight - (rows - 1) * spacing) / rows;

        for (let i = 0; i < sections.length; i++) {
          const section = sections[i];
          const row = Math.floor(i / cols);
          const col = i % cols;

          let width = sectionWidth;
          let height = width / section.aspectRatio;

          if (height > sectionHeight) {
            height = sectionHeight;
            width = height * section.aspectRatio;
          }

          const x =
            margin +
            col * (sectionWidth + spacing) +
            (sectionWidth - width) / 2;
          const y =
            margin +
            row * (sectionHeight + spacing) +
            (sectionHeight - height) / 2;

          await addImageToPDF(pdf, section.imageData, x, y, width, height);
        }
      }

      async function extractSectionImage(pageNum, selection) {
        const pageData = pageCanvases[pageNum];
        if (!pageData) {
          console.error(`No page data found for page ${pageNum}`);
          return null;
        }

        // Calculate the scaling factor between display canvas and actual canvas
        const displayCanvas = document.querySelector(
          `canvas[data-page-num="${pageNum}"]`
        );
        if (!displayCanvas) {
          console.error(`No display canvas found for page ${pageNum}`);
          return null;
        }

        const displayRect = displayCanvas.getBoundingClientRect();
        const scaleX = pageData.canvas.width / displayRect.width;
        const scaleY = pageData.canvas.height / displayRect.height;

        // Calculate actual coordinates on the full-resolution canvas
        const actualX = Math.max(0, selection.left * scaleX);
        const actualY = Math.max(0, selection.top * scaleY);
        const actualWidth = Math.min(
          selection.width * scaleX,
          pageData.canvas.width - actualX
        );
        const actualHeight = Math.min(
          selection.height * scaleY,
          pageData.canvas.height - actualY
        );

        // Skip if dimensions are invalid
        if (actualWidth <= 0 || actualHeight <= 0) {
          console.warn(
            `Invalid dimensions for selection: ${actualWidth}x${actualHeight}`
          );
          return null;
        }

        // Create a new canvas for the cropped section
        const croppedCanvas = document.createElement("canvas");
        const croppedContext = croppedCanvas.getContext("2d");
        croppedCanvas.width = actualWidth;
        croppedCanvas.height = actualHeight;

        // Draw the selected area onto the new canvas
        try {
          croppedContext.drawImage(
            pageData.canvas,
            actualX,
            actualY,
            actualWidth,
            actualHeight,
            0,
            0,
            actualWidth,
            actualHeight
          );

          return croppedCanvas.toDataURL("image/png");
        } catch (error) {
          console.error(
            `Error processing selection from page ${pageNum}:`,
            error
          );
          return null;
        }
      }

      async function addImageToPDF(pdf, imageData, x, y, width, height) {
        // Create a temporary image to get dimensions
        const img = new Image();
        return new Promise((resolve) => {
          img.onload = () => {
            pdf.addImage(imageData, "PNG", x, y, width, height);
            resolve();
          };
          img.src = imageData;
        });
      }

      function showSuccess() {
        const successMessage = document.getElementById("success-message");
        successMessage.style.display = "block";
        setTimeout(() => {
          successMessage.style.display = "none";
        }, 5000);
      }

      function showError(message) {
        const errorMessage = document.getElementById("error-message");
        errorMessage.textContent = message;
        errorMessage.style.display = "block";
        setTimeout(() => {
          errorMessage.style.display = "none";
        }, 5000);
      }
   