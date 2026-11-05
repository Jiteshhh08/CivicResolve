import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-utils'
import { IssueModel, UserModel, OrganizationModel, UserOrganizationModel, CategoryOrganizationMappingModel } from '@/lib/models'
import { emailService } from '@/lib/email-service'
import { serverCacheInvalidate } from '@/lib/server-cache'
import { notifyStatusChange } from '@/lib/whatsapp-notify'

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request)
    
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    // Admins act globally; staff must belong to a department to move a case.
    const organizationId = await UserModel.getUserOrganizationId(user.id)
    if (!organizationId && user.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'User is not associated with any organization' },
        { status: 400 }
      )
    }

    const params = await context.params
    const issueId = parseInt(params.id)
    const body = await request.json()
    const { status } = body

    if (!status) {
      return NextResponse.json(
        { error: 'Status is required' },
        { status: 400 }
      )
    }

    // Validate status transition
    const validStatuses = ['PENDING', 'IN_PROGRESS', 'RESOLVED']
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { error: 'Invalid status' },
        { status: 400 }
      )
    }

    // Check if user is trying to mark as RESOLVED
    if (status === 'RESOLVED') {
      // Allow admins to mark as resolved without photo requirement
      if (user.role === 'ADMIN') {
        console.log(`🔑 [STATUS UPDATE] Admin user bypassing photo requirement for resolution`)
      } else {
        // For organization members, encourage using the photo resolution feature
        return NextResponse.json(
          { 
            error: 'Resolution photo required', 
            message: 'Organization members must use the "Resolve with Photo" feature to provide visual proof of completion. This ensures transparency and accountability.',
            suggestion: 'Please use the "Resolve with Photo" button to upload a photo of the completed work.'
          },
          { status: 400 }
        )
      }
    }

    // Get the current issue details before updating
    const currentIssue = await IssueModel.findById(issueId)
    if (!currentIssue) {
      return NextResponse.json(
        { error: 'Issue not found' },
        { status: 404 }
      )
    }

    const oldStatus = currentIssue.status

    // A department can only move cases in its own categories; admins can move any
    if (user.role !== 'ADMIN') {
      const ownsCategory = await CategoryOrganizationMappingModel.organizationHandlesCategory(
        organizationId as number,
        currentIssue.category
      )
      if (!ownsCategory) {
        return NextResponse.json(
          { error: 'This issue belongs to another department' },
          { status: 403 }
        )
      }
    }

    // Update the issue status
    console.log(`🔄 [STATUS UPDATE] Updating issue ${issueId} status from "${oldStatus}" to "${status}"`)
    await IssueModel.updateStatus(issueId, status)
    console.log(`✅ [STATUS UPDATE] Issue status updated successfully`)

    // Invalidate cache after status update
    console.log(`🗑️ [STATUS UPDATE] **CACHE INVALIDATION TRIGGERED** - Issue status changed`)
    console.log(`🎯 [STATUS UPDATE] About to invalidate cache tags: ['issues', 'stats', 'analytics']`)
    await serverCacheInvalidate(['issues', 'stats', 'analytics'])
    console.log(`✅ [STATUS UPDATE] Cache invalidation completed - fresh data will be fetched on next request`)

    // Send email notification to the reporter about the status change
    try {
      // Get reporter details - handle both possible property names
      const reporterId = (currentIssue as any).reporterId || (currentIssue as any).reporter_id
      const reporter = await UserModel.findById(reporterId)
      
      // Get organization details
      const organization = organizationId ? await OrganizationModel.findById(organizationId) : null
      
      if (reporter && organization) {
        // Get the actual employee ID from user_organizations table
        const assignedToUserId = (currentIssue as any).assigned_to || (currentIssue as any).assignedTo || null
        let employeeId = null;
        
        if (assignedToUserId) {
          employeeId = await UserOrganizationModel.getEmployeeId(assignedToUserId, organizationId as number);
        }
        
        // Get the employee ID of the user making the update
        let updatedByEmployeeId = null;
        if (user.id && organizationId) {
          updatedByEmployeeId = await UserOrganizationModel.getEmployeeId(user.id, organizationId);
        }
        
        await emailService.sendStatusUpdateNotificationEmail(
          reporter.email,
          reporter.name,
          issueId,
          {
            title: currentIssue.title,
            description: currentIssue.description,
            category: currentIssue.category,
            address: currentIssue.address,
            latitude: currentIssue.latitude,
            longitude: currentIssue.longitude,
            priority: (currentIssue as any).priority || "MEDIUM"
          },
          oldStatus,
          status,
          employeeId,
          organization.name,
          updatedByEmployeeId
        )
      }
    } catch (emailError) {
      console.error('Failed to send status update notification email:', emailError)
      // Continue with success response even if email fails
    }

    // WhatsApp: mirror the email notification for citizens who linked a number
    try {
      const reporterId = (currentIssue as any).reporterId || (currentIssue as any).reporter_id
      const waReporter = await UserModel.findById(reporterId)
      if (waReporter?.phone) {
        await notifyStatusChange(waReporter.phone, issueId, currentIssue.title, status)
      }
    } catch (waError) {
      console.error('WhatsApp status notification failed:', waError)
    }

    return NextResponse.json({
      success: true,
      message: 'Issue status updated successfully'
    })

  } catch (error) {
    console.error('Error updating issue status:', error)
    return NextResponse.json(
      { error: 'Failed to update issue status' },
      { status: 500 }
    )
  }
}
